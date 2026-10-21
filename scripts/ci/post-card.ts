// ======================================================
// CI - Telegram rich message payload builder
// ======================================================

import { readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const RICH_LIMIT = 32768

const [payloadPath, attachmentsPath] = process.argv.slice(2)
if (!payloadPath || !attachmentsPath) throw new Error('usage: post-card.ts <out-payload-json> <out-attachments-file>')

const apkDir = resolve(process.env.APK_DIR ?? 'out')

const abis = ['arm64-v8a', 'armeabi-v7a']
const files = readdirSync(apkDir).filter(f => f.endsWith('.apk'))
const apks = abis.flatMap(abi => files.filter(f => f.includes(abi)))
if (apks.length === 0) throw new Error(`no APK found in ${apkDir}`)

const parsed = apks[0].match(/^luminegram-.+-(\d[\w.]*)-(beta|release)\.apk$/)
if (!parsed) throw new Error(`cannot read version from ${apks[0]}`)
const [, base, type] = parsed
const buildType = type[0].toUpperCase() + type.slice(1)

const infoTable = `<table bordered><tr><td>Build Type</td><td>${buildType}</td></tr><tr><td>Base</td><td>${base}</td></tr></table>`
const parts = [
  '# luminegram Build Completed',
  infoTable,
  ...apks.map((_, i) => `![](tg://document?id=apk${i + 1})`),
]

const markdown = `${parts.join('\n\n')}\n`
if (markdown.length > RICH_LIMIT) throw new Error(`post-card: ${markdown.length} chars exceeds ${RICH_LIMIT}`)

const media = apks.map((_, i) => ({ id: `apk${i + 1}`, media: { type: 'document', media: `attach://apk_${i + 1}` } }))
writeFileSync(payloadPath, JSON.stringify({ markdown, media }))
writeFileSync(attachmentsPath, `${apks.map((file, i) => `apk_${i + 1}=@${join(apkDir, file)};filename=${file}`).join('\n')}\n`)

console.error(`post-card: ${apks.length} apk(s), ${markdown.length} chars (limit ${RICH_LIMIT})`)
