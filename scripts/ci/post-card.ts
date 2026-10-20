// ======================================================
// CI - Telegram rich message payload builder
// ======================================================

import { execFileSync } from 'node:child_process'
import { readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const RICH_LIMIT = 32768
const DEFAULT_COMMITS = 5
const MAX_COMMITS = 20

const [payloadPath, attachmentsPath] = process.argv.slice(2)
if (!payloadPath || !attachmentsPath) throw new Error('usage: post-card.ts <out-payload-json> <out-attachments-file>')

const apkDir = resolve(process.env.APK_DIR ?? 'out')
const head = process.env.GITHUB_SHA || 'HEAD'

function escapeText(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_[\]~|#]/g, '\\$&')
}

function escapeAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function git(...args: string[]) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function changelogBase(count: number) {
  if (count > 0) {
    try {
      return git('rev-parse', '--verify', `${head}~${count}`)
    } catch {
      return git('rev-list', '--max-parents=0', head).split('\n')[0]
    }
  }
  const prev = process.env.CHANGELOG_BASE?.trim()
  if (prev) {
    try {
      return git('rev-parse', '--verify', `${prev}^{commit}`)
    } catch {}
  }
  try {
    return git('rev-parse', '--verify', `${head}~${DEFAULT_COMMITS}`)
  } catch {
    return ''
  }
}

function changelog() {
  const count = Number(process.env.CHANGELOG_COUNT || 0)
  if (!Number.isInteger(count) || count < 0) throw new Error(`invalid CHANGELOG_COUNT: ${process.env.CHANGELOG_COUNT}`)
  const out = execFileSync('bun', ['scripts/ci/get-commits.ts', changelogBase(count), head], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const commits: { message: string }[] = JSON.parse(out)
  return commits
    .map(c => c.message.split('\n')[0].trim())
    .filter(Boolean)
    .slice(0, count || MAX_COMMITS)
}

const abis = [
  { match: 'arm64', label: 'apk64' },
  { match: 'armeabi-v7a', label: 'apk32' },
]
const files = readdirSync(apkDir).filter(f => f.endsWith('.apk'))
const apks = abis.flatMap(abi => files.filter(f => f.includes(abi.match)).map(file => ({ file, label: abi.label })))
if (apks.length === 0) throw new Error(`no APK found in ${apkDir}`)

const buttons = [
  [['Support', process.env.TELEGRAM_SUPPORT_URL], ['Channel', process.env.TELEGRAM_CHANNEL_URL], ['Chat group', process.env.TELEGRAM_GROUP_URL]],
  [['Group topic', process.env.TELEGRAM_TOPIC_URL]],
]

function buttonRow(row: (string | undefined)[][]) {
  const live = row.filter(([, url]) => url?.trim())
  if (live.length === 0) return ''
  const items = live.map(([text, url]) => `  <tg-button type="url" style="primary" url="${escapeAttr(url!.trim())}">${text}</tg-button>`)
  return ['<tg-button-row>', ...items, '</tg-button-row>'].join('\n')
}

const lines = changelog()
const parts = ['# luminegram Update']
if (lines.length > 0) parts.push(lines.map(l => `> • ${escapeText(l)}`).join('\n'))
apks.forEach((apk, i) => {
  parts.push(`<tg-button-row><tg-button type="disabled" style="primary">${apk.label}</tg-button></tg-button-row>\n\n![](tg://document?id=apk${i + 1})`)
})
for (const row of buttons) {
  const rendered = buttonRow(row)
  if (rendered) parts.push(rendered)
}

const markdown = `${parts.join('\n\n')}\n`
if (markdown.length > RICH_LIMIT) throw new Error(`post-card: ${markdown.length} chars exceeds ${RICH_LIMIT}`)

const media = apks.map((_, i) => ({ id: `apk${i + 1}`, media: { type: 'document', media: `attach://apk_${i + 1}` } }))
writeFileSync(payloadPath, JSON.stringify({ markdown, media }))
writeFileSync(attachmentsPath, `${apks.map((apk, i) => `apk_${i + 1}=@${join(apkDir, apk.file)};filename=${apk.file}`).join('\n')}\n`)

console.error(`post-card: ${apks.length} apk(s), ${lines.length} commit(s), ${markdown.length} chars (limit ${RICH_LIMIT})`)
