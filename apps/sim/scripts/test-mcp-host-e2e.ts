import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'

/** Exercises the public ownership challenge and host isolation through a running local app. */
const logger = createLogger('McpHostE2E')
const CHALLENGE_PATH = '/.well-known/openai-apps-challenge'
const EXPECTED_CHALLENGE = 'lFJ1-XIWpHGRNcgzTPl2Y_yYCTWLvlIbAvNRD08EvLI'
const MCP_HOST = 'mcp.sim.test'
const startedAt = new Date().toISOString()

const configuredBaseUrl = process.env.MCP_HOST_E2E_BASE_URL
const reportPath = process.env.MCP_HOST_E2E_REPORT_PATH
assert(configuredBaseUrl, 'MCP_HOST_E2E_BASE_URL must be explicitly provided')
assert(reportPath, 'MCP_HOST_E2E_REPORT_PATH must be explicitly provided')
const baseUrl = new URL(configuredBaseUrl)
assert(['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname), 'Use a loopback app')
assert.equal(baseUrl.protocol, 'http:', 'Use a local HTTP app')
assert.equal(baseUrl.pathname, '/', 'App URL must be an origin')
assert(!baseUrl.username && !baseUrl.password, 'App URL must not contain credentials')
assert.equal(process.env.SIM_MCP_URL, `http://${MCP_HOST}/mcp`, 'Configure the fixture MCP host')

interface CheckResult {
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  error?: string
}

const checks: CheckResult[] = []
const requests: { path: string; userAgent: string; host: string; status: number }[] = []

async function request(path: string, userAgent: string, host = MCP_HOST) {
  // boundary-raw-fetch: exercise the real proxy and route over local HTTP.
  const response = await fetch(new URL(path, baseUrl), {
    headers: { Host: host, 'User-Agent': userAgent },
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
  })
  requests.push({ path, userAgent, host, status: response.status })
  const body = await response.text()
  return { response, body }
}

async function check(name: string, run: () => Promise<void>) {
  const started = performance.now()
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) })
    logger.info(`PASS ${name}`)
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      error: getErrorMessage(error),
    })
    logger.error(`FAIL ${name}`, { error: getErrorMessage(error) })
  }
}

try {
  for (const userAgent of ['', 'python-requests/2.32.3']) {
    await check(`ownership challenge for ${userAgent || 'an empty User-Agent'}`, async () => {
      const { response, body } = await request(CHALLENGE_PATH, userAgent)
      assert.equal(response.status, 200)
      assert.equal(body, EXPECTED_CHALLENGE)
      assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8')
      assert.equal(response.headers.get('cache-control'), 'no-store')
    })
  }

  for (const path of [`${CHALLENGE_PATH}/extra`, '/login', '/api/health']) {
    await check(`dedicated MCP host rejects ${path}`, async () => {
      const { response } = await request(path, 'Mozilla/5.0')
      assert.equal(response.status, 404)
    })
  }

  await check('application host still serves health checks', async () => {
    const { response } = await request('/api/health', 'Mozilla/5.0', baseUrl.host)
    assert.equal(response.status, 200)
  })
} finally {
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(
    reportPath,
    JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), checks, requests }, null, 2)
  )
}

if (checks.some((result) => result.status === 'failed')) process.exitCode = 1
