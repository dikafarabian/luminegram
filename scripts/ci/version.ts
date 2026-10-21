import fs from 'node:fs/promises'

const worktree = process.env.WT ?? (process.argv.includes('--pluginless') ? 'worktree-pluginless' : 'worktree')
const props = await fs.readFile(`${worktree}/gradle.properties`, 'utf8')
const appVerName = /^APP_VERSION_NAME=(.+)$/m.exec(props)?.[1]
if (!appVerName) throw new Error('failed to read APP_VERSION_NAME')

const buildType = process.env.BUILD_TYPE ?? 'release'
if (buildType !== 'beta' && buildType !== 'release') throw new Error(`invalid BUILD_TYPE: ${buildType}`)

const shortSha = (process.env.GITHUB_SHA ?? '').slice(0, 7)

const now = new Date()
const date = [
  now.getUTCFullYear(),
  String(now.getUTCMonth() + 1).padStart(2, '0'),
  String(now.getUTCDate()).padStart(2, '0'),
].join('')

const runsToday = Number(process.env.RUNS_TODAY)
const dailyCounter = runsToday - 1
if (!Number.isInteger(dailyCounter) || dailyCounter < 0) {
  throw new Error(`invalid RUNS_TODAY: ${process.env.RUNS_TODAY}`)
}
if (dailyCounter > 99) {
  throw new Error(`100+ runs today (counter=${dailyCounter}), versionCode slot exhausted, wait for UTC midnight`)
}

const verCode = Number(date) * 100 + dailyCounter

const out = {
  'ver-name': `${appVerName}-${shortSha}`,
  'ver-code': String(verCode),
  date,
  'apk-arm64': `luminegram-arm64-v8a-${appVerName}-${buildType}.apk`,
  'apk-arm7': `luminegram-armeabi-v7a-${appVerName}-${buildType}.apk`,
}

const githubOutput = process.env.GITHUB_OUTPUT
if (githubOutput) {
  await fs.appendFile(githubOutput, `${Object.entries(out).map(([k, v]) => `${k}=${v}`).join('\n')}\n`)
}

console.log(JSON.stringify(out, null, 2))
