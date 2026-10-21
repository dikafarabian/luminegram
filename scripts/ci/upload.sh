#!/usr/bin/env bash

# ======================================================
# CI - Telegram Rich Message Post (local Bot API server)
# ======================================================

set -euo pipefail

: "${TELEGRAM_API_ID:?}" "${TELEGRAM_API_HASH:?}" "${TELEGRAM_BOT_TOKEN:?}"

DESTINATION="${DESTINATION:-private}"
case "$DESTINATION" in
    private) target="${TELEGRAM_PRIVATE_CHAT:?}" ;;
    community) target="${TELEGRAM_ARTIFACT_URL:?}" ;;
    *) echo "unknown destination: $DESTINATION" >&2; exit 1 ;;
esac

thread_ref=""
if [[ "$target" =~ ^-?[0-9]+$ ]]; then
    CHAT_ID="$target"
else
    link="${target%%[?#]*}"
    link="${link%/}"
    case "$link" in
        https://t.me/c/*)
            IFS=/ read -r chat_ref thread_ref _ <<< "${link#https://t.me/c/}"
            [[ "$chat_ref" =~ ^[0-9]+$ ]] || { echo "invalid $DESTINATION target" >&2; exit 1; }
            CHAT_ID="-100${chat_ref}"
            ;;
        https://t.me/*)
            IFS=/ read -r chat_ref thread_ref _ <<< "${link#https://t.me/}"
            [[ "$chat_ref" =~ ^[A-Za-z][A-Za-z0-9_]{3,}$ ]] || { echo "invalid $DESTINATION target" >&2; exit 1; }
            CHAT_ID="@${chat_ref}"
            ;;
        *)
            echo "invalid $DESTINATION target" >&2
            exit 1
            ;;
    esac
fi
THREAD_ID="${thread_ref:-}"
[ -z "$THREAD_ID" ] || [[ "$THREAD_ID" =~ ^[0-9]+$ ]] || { echo "invalid $DESTINATION target" >&2; exit 1; }

APK_DIR="${APK_DIR:-out}"
API_BASE="http://localhost:8081"
MAX_RETRIES="${TELEGRAM_MAX_RETRIES:-3}"
API_TIMEOUT="${TELEGRAM_API_TIMEOUT:-900}"
RESPONSE_FILE="$(mktemp)"
PAYLOAD_FILE="$(mktemp)"
ATTACHMENTS_FILE="$(mktemp)"

cleanup() {
    rm -f "$RESPONSE_FILE" "$PAYLOAD_FILE" "$ATTACHMENTS_FILE"
    docker rm -f tg-bot-api >/dev/null 2>&1 || true
}
trap cleanup EXIT

bun scripts/ci/post-card.ts "$PAYLOAD_FILE" "$ATTACHMENTS_FILE"
mapfile -t attachment_specs < "$ATTACHMENTS_FILE"

docker run -d --name tg-bot-api -p 8081:8081 \
    -e TELEGRAM_API_ID \
    -e TELEGRAM_API_HASH \
    -e TELEGRAM_LOCAL=true \
    aiogram/telegram-bot-api:latest >/dev/null

ready=0
for _ in $(seq 1 30); do
    if curl -sf "$API_BASE/bot${TELEGRAM_BOT_TOKEN}/getMe" >/dev/null; then
        ready=1
        break
    fi
    sleep 1
done
if [ "$ready" != "1" ]; then
    docker logs tg-bot-api >&2
    exit 1
fi

send_args=(--form-string "chat_id=${CHAT_ID}" -F "rich_message=<${PAYLOAD_FILE}")
[ -n "$THREAD_ID" ] && send_args+=(--form-string "message_thread_id=${THREAD_ID}")
for spec in "${attachment_specs[@]}"; do
    send_args+=(-F "$spec")
done

attempt=1
while [ "$attempt" -le "$MAX_RETRIES" ]; do
    http_code=$(curl -s -o "$RESPONSE_FILE" -w "%{http_code}" \
        --max-time "$API_TIMEOUT" --retry 0 \
        -X POST "$API_BASE/bot${TELEGRAM_BOT_TOKEN}/sendRichMessage" \
        "${send_args[@]}") || http_code="000"

    if [ "$http_code" = "200" ] && grep -q '"ok":true' "$RESPONSE_FILE"; then
        echo "sent ${#attachment_specs[@]} apk(s)"
        exit 0
    fi

    case "$http_code" in
        000|429|500|502|503|504)
            echo "send failed: HTTP $http_code, attempt $attempt/$MAX_RETRIES" >&2
            ;;
        *)
            echo "send failed: HTTP $http_code (non-retryable)" >&2
            cat "$RESPONSE_FILE" >&2
            exit 1
            ;;
    esac

    [ "$attempt" -lt "$MAX_RETRIES" ] && sleep $((2 ** attempt))
    attempt=$((attempt + 1))
done
exit 1
