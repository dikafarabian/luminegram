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

const abis = ['arm64-v8a', 'armeabi-v7a']
const files = readdirSync(apkDir).filter(f => f.endsWith('.apk'))
const apks = abis.flatMap(abi => files.filter(f => f.includes(abi)))
if (apks.length === 0) throw new Error(`no APK found in ${apkDir}`)

const parsed = apks[0].match(/^luminegram-.+-(\d[\w.]*)-(beta|release)\.apk$/)
if (!parsed) throw new Error(`cannot read version from ${apks[0]}`)
const [, base, type] = parsed
const buildType = type[0].toUpperCase() + type.slice(1)

const chip = (label: string, style: string) => `<tg-button type="disabled" style="${style}">${label}</tg-button>`

const lines = changelog().map(l => l.replace(/`/g, "'"))
const parts = [
  '# luminegram Build Completed',
  `> \`Build Type : ${buildType}\`\n>\n> \`Base : ${base}\``,
  `<tg-button-row>${chip('Download', 'primary')}</tg-button-row>`,
  ...apks.map((_, i) => `![](tg://document?id=apk${i + 1})`),
]
if (lines.length > 0) {
  parts.push([
    '<blockquote>',
    '<details>',
    `<summary>${chip('Changelog', 'success')}</summary>`,
    '',
    '```',
    ...lines.map(l => `- ${l}`),
    '```',
    '</details>',
    '</blockquote>',
  ].join('\n'))
}

const markdown = `${parts.join('\n\n')}\n`
if (markdown.length > RICH_LIMIT) throw new Error(`post-card: ${markdown.length} chars exceeds ${RICH_LIMIT}`)

const media = apks.map((_, i) => ({ id: `apk${i + 1}`, media: { type: 'document', media: `attach://apk_${i + 1}` } }))
writeFileSync(payloadPath, JSON.stringify({ markdown, media }))
writeFileSync(attachmentsPath, `${apks.map((file, i) => `apk_${i + 1}=@${join(apkDir, file)};filename=${file}`).join('\n')}\n`)

console.error(`post-card: ${apks.length} apk(s), ${lines.length} commit(s), ${markdown.length} chars (limit ${RICH_LIMIT})`)
