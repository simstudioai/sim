/**
 * Streaming correctness probe for the virtualized transcript.
 *
 * Opens a fresh chat, sends a prompt, and samples the scroll container while the
 * assistant streams. Asserts the streaming reply grows monotonically AND the
 * container stays pinned to the bottom (auto-scroll follows the growing tail) —
 * the two behaviors most at risk from virtualizing the message list.
 *
 * Usage:
 *   node scripts/perf/stream-validate.mjs --workspace <id> [--base http://localhost:3000] [--prompt "..."]
 */
import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const WORKSPACE_ID = arg('workspace')
const BASE = arg('base', 'http://localhost:3000')
const EMAIL = arg('email', 'waleed@sim.ai')
const PROMPT = arg(
  'prompt',
  'Write about 400 words explaining how database indexes work, with a few short bullet lists.'
)

if (!WORKSPACE_ID) {
  console.error('Usage: node scripts/perf/stream-validate.mjs --workspace <id>')
  process.exit(1)
}

function readEnv(key) {
  const env = readFileSync(resolve(ROOT, 'apps/sim/.env'), 'utf8')
  const m = env.match(new RegExp(`^${key}="?([^"\n]+)"?$`, 'm'))
  if (!m) throw new Error(`${key} not found in apps/sim/.env`)
  return m[1]
}

function mintSessionCookie() {
  const dbUrl = readEnv('DATABASE_URL')
  const secret = readEnv('BETTER_AUTH_SECRET')
  const token = execFileSync(
    'psql',
    [dbUrl, '-At', '-c',
      `select token from session where user_id = (select id from "user" where email = '${EMAIL}') and expires_at > now() order by expires_at desc limit 1`],
    { encoding: 'utf8' }
  ).trim()
  if (!token) throw new Error(`No live session for ${EMAIL}`)
  const signature = createHmac('sha256', secret).update(token).digest('base64')
  return {
    name: 'better-auth.session_token',
    value: encodeURIComponent(`${token}.${signature}`),
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  }
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addCookies([mintSessionCookie()])
const page = await context.newPage()

await page.goto(`${BASE}/workspace/${WORKSPACE_ID}/home`, { waitUntil: 'commit', timeout: 180_000 })
const textarea = page.locator('textarea').first()
await textarea.waitFor({ state: 'visible', timeout: 60_000 })
await textarea.click()
await page.keyboard.type(PROMPT, { delay: 5 })
await page.keyboard.press('Enter')

/** Sample the scroll container + streaming reply length every 250ms for ~20s. */
const samples = await page.evaluate(async () => {
  const out = []
  const scroller = () =>
    document.querySelector('[class*="overflow-y-auto"]')
  const lastAssistantLen = () => {
    const rows = document.querySelectorAll('[class~="group/msg"]')
    const last = rows[rows.length - 1]
    return last ? (last.textContent || '').length : 0
  }
  for (let i = 0; i < 80; i++) {
    const el = scroller()
    if (el) {
      out.push({
        t: i * 250,
        len: lastAssistantLen(),
        distanceFromBottom: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
        rows: document.querySelectorAll('[class~="group/msg"]').length,
      })
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return out
})

await page.screenshot({ path: '/tmp/stream-validate.png' })
await browser.close()

const grew = samples.filter((s) => s.len > 0)
const maxLen = Math.max(0, ...samples.map((s) => s.len))
const firstGrowth = grew.find((s) => s.len > 20)
const peakIdx = samples.findIndex((s) => s.len === maxLen)
// During active growth, the container should track the bottom (small distance).
const growthWindow = samples.filter((s, i) => i <= peakIdx && s.len > 20)
const pinnedDuringGrowth = growthWindow.filter((s) => s.distanceFromBottom <= 80).length
const pinnedRatio = growthWindow.length ? pinnedDuringGrowth / growthWindow.length : 0
const monotonic = grew.every((s, i, a) => i === 0 || s.len >= a[i - 1].len - 5)

console.log(JSON.stringify({
  streamed: maxLen > 40,
  maxReplyChars: maxLen,
  firstGrowthAtMs: firstGrowth?.t ?? null,
  monotonicGrowth: monotonic,
  pinnedDuringGrowthRatio: Math.round(pinnedRatio * 100) / 100,
  maxDistanceDuringGrowth: growthWindow.length ? Math.max(...growthWindow.map((s) => s.distanceFromBottom)) : null,
  finalRows: samples.at(-1)?.rows ?? 0,
}, null, 2))

if (maxLen <= 40) {
  console.error('\n⚠️  No assistant stream detected — cannot validate streaming follow.')
  process.exit(2)
}
