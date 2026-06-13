/**
 * Chat loading performance harness.
 *
 * Opens a Mothership chat in headless Chromium (authenticated via a Better Auth
 * session cookie minted from the local DB) and measures where time goes:
 *   - API: GET /api/mothership/chats/<chatId> duration
 *   - firstRowMs: time from navigation to first message row painted
 *   - allRowsMs: time until the progressive list finishes (row count stable 1.5s)
 *   - domNodes / heapMB after the transcript is fully rendered
 *   - long tasks (main-thread blocks > 50ms) during load
 *   - typing frame stats: rAF frame durations while typing into the chat input
 *
 * Usage:
 *   node scripts/perf/chat-load-perf.mjs --chat <chatId> --workspace <workspaceId> \
 *     [--base http://localhost:3000] [--email waleed@sim.ai] [--runs 3] [--headed]
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

const CHAT_ID = arg('chat')
const WORKSPACE_ID = arg('workspace')
const BASE = arg('base', 'http://localhost:3000')
const EMAIL = arg('email', 'waleed@sim.ai')
const RUNS = Number(arg('runs', '3'))
const HEADED = process.argv.includes('--headed')
const REACT_SCAN = process.argv.includes('--react-scan')
const SEND = process.argv.includes('--send')
const REACT_SCAN_BUNDLE = '/tmp/react-scan-auto.global.js'

if (!CHAT_ID || !WORKSPACE_ID) {
  console.error('Usage: node scripts/perf/chat-load-perf.mjs --chat <chatId> --workspace <workspaceId>')
  process.exit(1)
}

function readEnv(key) {
  const env = readFileSync(resolve(ROOT, 'apps/sim/.env'), 'utf8')
  const m = env.match(new RegExp(`^${key}="?([^"\n]+)"?$`, 'm'))
  if (!m) throw new Error(`${key} not found in apps/sim/.env`)
  return m[1]
}

/** Mint a signed Better Auth session cookie from a live session row in the local DB. */
function mintSessionCookie() {
  const dbUrl = readEnv('DATABASE_URL')
  const secret = readEnv('BETTER_AUTH_SECRET')
  const token = execFileSync(
    'psql',
    [dbUrl, '-At', '-c',
      `select token from session where user_id = (select id from "user" where email = '${EMAIL}') and expires_at > now() order by expires_at desc limit 1`],
    { encoding: 'utf8' }
  ).trim()
  if (!token) throw new Error(`No live session for ${EMAIL} in local DB — log in once at ${BASE} first`)
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

/** Injected at document start: watches message rows, long tasks, and DOM size. */
const INIT_SCRIPT = `(() => {
  const perf = { firstRowAt: null, stableAt: null, rowCount: 0, domNodes: null, heapMB: null,
                 longTasks: 0, longTaskMs: 0, maxLongTaskMs: 0, done: false }
  window.__chatPerf = perf
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        perf.longTasks++
        perf.longTaskMs += e.duration
        if (e.duration > perf.maxLongTaskMs) perf.maxLongTaskMs = e.duration
      }
    }).observe({ type: 'longtask', buffered: true })
  } catch {}
  let lastCount = 0
  let lastChange = performance.now()
  const tick = () => {
    const rows = document.querySelectorAll('[class~="group/msg"]').length
    if (rows > 0 && perf.firstRowAt == null) perf.firstRowAt = performance.now()
    if (rows !== lastCount) { lastCount = rows; lastChange = performance.now(); perf.rowCount = rows }
    if (rows > 0 && performance.now() - lastChange > 1500 && !perf.done) {
      perf.stableAt = lastChange
      perf.domNodes = document.getElementsByTagName('*').length
      perf.heapMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null
      perf.done = true
      return
    }
    setTimeout(tick, 50)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick)
  else tick()
})()`

/** Aggregates react-scan onRender callbacks into per-component totals on window.__reactScanAgg. */
const REACT_SCAN_CONFIG = `(() => {
  if (typeof window.reactScan !== 'function') return
  window.__reactScanAgg = Object.create(null)
  window.reactScan({
    showToolbar: false,
    log: false,
    showFPS: false,
    showNotificationCount: false,
    trackUnnecessaryRenders: true,
    onRender: (fiber, renders) => {
      const t = fiber && fiber.type
      const name = (t && (t.displayName || t.name)) || (typeof t === 'string' ? t : 'Unknown')
      const agg = window.__reactScanAgg[name] || (window.__reactScanAgg[name] = { renders: 0, time: 0, unnecessary: 0 })
      for (const r of renders) {
        agg.renders++
        agg.time += r.time || 0
        if (r.unnecessary) agg.unnecessary++
      }
    },
  })
})()`

async function snapshotReactScan(page, top = 12) {
  return page.evaluate((topN) => {
    const agg = window.__reactScanAgg || {}
    const rows = Object.entries(agg)
      .map(([name, a]) => ({ name, renders: a.renders, timeMs: Math.round(a.time * 10) / 10, unnecessary: a.unnecessary }))
      .sort((a, b) => b.timeMs - a.timeMs)
      .slice(0, topN)
    window.__reactScanAgg = Object.create(null)
    return rows
  }, top)
}

async function measureRun(context, url, { screenshotPath } = {}) {
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })

  let apiMs = null
  let apiBytes = null
  page.on('response', async (res) => {
    if (res.url().includes(`/api/mothership/chats/${CHAT_ID}`) && res.request().method() === 'GET') {
      try { apiBytes = (await res.body()).length } catch {}
    }
  })
  page.on('requestfinished', (req) => {
    if (req.url().includes(`/api/mothership/chats/${CHAT_ID}`) && req.method() === 'GET') {
      apiMs = Math.round(req.timing().responseEnd)
    }
  })

  await page.goto(url, { waitUntil: 'commit', timeout: 180_000 })
  await page.waitForFunction(() => window.__chatPerf?.done === true, null, { timeout: 90_000 })
  const m = await page.evaluate(() => window.__chatPerf)

  if (page.url().includes('/login')) throw new Error('Redirected to /login — session cookie rejected')
  if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: false })

  const loadRenders = REACT_SCAN ? await snapshotReactScan(page) : null

  const textarea = page.locator('textarea').first()
  let typing = null
  try {
    await textarea.click({ timeout: 5000 })
    await page.evaluate(() => {
      const lat = []
      window.__keyLat = lat
      document.addEventListener('keydown', () => {
        const t = performance.now()
        requestAnimationFrame(() => lat.push(performance.now() - t))
      }, { capture: true })
    })
    const text = 'why is the chat so slow when the transcript is long? '.repeat(5)
    await page.keyboard.type(text, { delay: 10 })
    typing = await page.evaluate(() => {
      const lat = (window.__keyLat || []).slice().sort((a, b) => a - b)
      if (!lat.length) return null
      return {
        keys: lat.length,
        avgKeyMs: Math.round(lat.reduce((s, d) => s + d, 0) / lat.length * 10) / 10,
        p95KeyMs: Math.round(lat[Math.floor(lat.length * 0.95)] * 10) / 10,
        maxKeyMs: Math.round(lat[lat.length - 1] * 10) / 10,
      }
    })
  } catch { /* typing probe is best-effort */ }

  const typingRenders = REACT_SCAN ? await snapshotReactScan(page) : null

  let streaming = null
  let streamRenders = null
  if (SEND) {
    try {
      await page.evaluate(() => { if (window.__keyLat) window.__keyLat.length = 0 })
      await page.keyboard.press('Enter')
      await page.waitForTimeout(1500)
      const probeUntil = Date.now() + 15_000
      while (Date.now() < probeUntil) {
        await page.keyboard.type('still typing while the assistant streams ', { delay: 30 })
      }
      streaming = await page.evaluate(() => {
        const lat = (window.__keyLat || []).slice().sort((a, b) => a - b)
        if (!lat.length) return null
        return {
          keys: lat.length,
          avgKeyMs: Math.round(lat.reduce((s, d) => s + d, 0) / lat.length * 10) / 10,
          p95KeyMs: Math.round(lat[Math.floor(lat.length * 0.95)] * 10) / 10,
          maxKeyMs: Math.round(lat[lat.length - 1] * 10) / 10,
        }
      })
      streamRenders = REACT_SCAN ? await snapshotReactScan(page) : null
      await page.screenshot({ path: `/tmp/chat-perf-send-${CHAT_ID.slice(0, 8)}.png` })
    } catch (e) {
      console.error(`  send probe failed: ${e.message.split('\n')[0]}`)
    }
  }

  await page.close()
  return {
    loadRenders,
    typingRenders,
    streaming,
    streamRenders,
    apiMs,
    apiKB: apiBytes != null ? Math.round(apiBytes / 1024) : null,
    firstRowMs: m.firstRowAt != null ? Math.round(m.firstRowAt) : null,
    allRowsMs: m.stableAt != null ? Math.round(m.stableAt) : null,
    rowCount: m.rowCount,
    domNodes: m.domNodes,
    heapMB: m.heapMB,
    longTasks: m.longTasks,
    longTaskMs: Math.round(m.longTaskMs),
    maxLongTaskMs: Math.round(m.maxLongTaskMs),
    typing,
    consoleErrors: consoleErrors.slice(0, 5),
  }
}

const cookie = mintSessionCookie()
const browser = await chromium.launch({ headless: !HEADED })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addCookies([cookie])
if (REACT_SCAN) {
  await context.addInitScript(readFileSync(REACT_SCAN_BUNDLE, 'utf8'))
  await context.addInitScript(REACT_SCAN_CONFIG)
}
await context.addInitScript(INIT_SCRIPT)

const url = `${BASE}/workspace/${WORKSPACE_ID}/chat/${CHAT_ID}`
console.log(`Measuring ${url} (${RUNS} runs + warmup)`)

try {
  await measureRun(context, url) // warmup: Next.js dev compiles the route on first hit
} catch (e) {
  console.error(`Warmup failed: ${e.message}`)
  await browser.close()
  process.exit(1)
}

const results = []
for (let i = 0; i < RUNS; i++) {
  const screenshotPath = i === 0 ? `/tmp/chat-perf-${CHAT_ID.slice(0, 8)}.png` : undefined
  const r = await measureRun(context, url, { screenshotPath })
  results.push(r)
  console.log(`run ${i + 1}: api=${r.apiMs}ms (${r.apiKB}KB) firstRow=${r.firstRowMs}ms allRows=${r.allRowsMs}ms rows=${r.rowCount} dom=${r.domNodes} heap=${r.heapMB}MB longTasks=${r.longTasks}/${r.longTaskMs}ms(max ${r.maxLongTaskMs}ms) keystroke avg=${r.typing?.avgKeyMs}ms p95=${r.typing?.p95KeyMs}ms max=${r.typing?.maxKeyMs}ms (${r.typing?.keys} keys)`)
  if (r.consoleErrors.length) console.log(`  console errors: ${r.consoleErrors.join(' | ')}`)
  if (r.loadRenders) {
    console.log('  react-scan LOAD phase (top by self time):')
    for (const c of r.loadRenders) console.log(`    ${c.name}: ${c.renders} renders, ${c.timeMs}ms, ${c.unnecessary} unnecessary`)
    console.log('  react-scan TYPING phase (top by self time):')
    for (const c of r.typingRenders ?? []) console.log(`    ${c.name}: ${c.renders} renders, ${c.timeMs}ms, ${c.unnecessary} unnecessary`)
  }
  if (r.streaming) {
    console.log(`  STREAMING keystroke: avg=${r.streaming.avgKeyMs}ms p95=${r.streaming.p95KeyMs}ms max=${r.streaming.maxKeyMs}ms (${r.streaming.keys} keys)`)
    if (r.streamRenders) {
      console.log('  react-scan STREAM phase (top by self time):')
      for (const c of r.streamRenders) console.log(`    ${c.name}: ${c.renders} renders, ${c.timeMs}ms, ${c.unnecessary} unnecessary`)
    }
  }
}

const median = (key, sub) => {
  const vals = results.map((r) => (sub ? r[key]?.[sub] : r[key])).filter((v) => v != null).sort((a, b) => a - b)
  return vals.length ? vals[Math.floor(vals.length / 2)] : null
}

console.log('\nmedian:', JSON.stringify({
  apiMs: median('apiMs'),
  apiKB: median('apiKB'),
  firstRowMs: median('firstRowMs'),
  allRowsMs: median('allRowsMs'),
  rowCount: median('rowCount'),
  domNodes: median('domNodes'),
  heapMB: median('heapMB'),
  longTasks: median('longTasks'),
  longTaskMs: median('longTaskMs'),
  maxLongTaskMs: median('maxLongTaskMs'),
  keystrokeAvgMs: median('typing', 'avgKeyMs'),
  keystrokeP95Ms: median('typing', 'p95KeyMs'),
  keystrokeMaxMs: median('typing', 'maxKeyMs'),
}))

await browser.close()
