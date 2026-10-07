/** Exercises the real homepage handler and proxy over loopback HTTP, without provisioning sessions or a database. */
import assert from 'node:assert/strict'
import { type SpawnSyncReturns, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { getErrorMessage } from '@sim/utils/errors'
import { NextRequest } from 'next/server'

const reportPath = process.env.LANDING_BRIDGE_REPORT_PATH
assert(reportPath, 'Set LANDING_BRIDGE_REPORT_PATH')
if (!process.argv.includes('--child')) {
  for (const hosted of ['true', 'false']) {
    const child: SpawnSyncReturns<Buffer> = spawnSync(
      process.execPath,
      ['--no-env-file', ...process.argv.slice(1), '--child'],
      {
        stdio: 'inherit',
        env: {
          PATH: process.env.PATH,
          NODE_ENV: 'test',
          NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
          NEXT_PUBLIC_FORCE_HOSTED: hosted,
          DISABLE_AUTH: 'false',
          LANDING_BRIDGE_REPORT_PATH: reportPath.replace('.json', `-${hosted}.json`),
        },
      }
    )
    assert.equal(child.status, 0, `hosted=${hosted}`)
  }
  process.exit(0)
}
const hosted = process.env.NEXT_PUBLIC_FORCE_HOSTED === 'true'
let mode = 'html'
let received: http.IncomingHttpHeaders | undefined
let receivedUrl = ''
let redirected = false
const upstream = http.createServer((request, response) => {
  received = request.headers
  receivedUrl = request.url || ''
  if (request.url === '/redirect-target') redirected = true
  if (mode === 'redirect') {
    response.writeHead(302, { Location: '/redirect-target' })
    response.end()
    return
  }
  if (mode === 'error') {
    response.writeHead(500)
    response.end('internal-error-sentinel')
    return
  }
  response.writeHead(200, {
    'Content-Type': mode === 'json' ? 'application/json' : 'text/html',
    'Set-Cookie': 'injected=bad',
    'Cache-Control': 'public, max-age=31536000',
    'Access-Control-Allow-Origin': '*',
  })
  if (mode === 'slow') return
  response.end(
    mode === 'oversize'
      ? 'x'.repeat(3 * 1024 * 1024)
      : '<!doctype html><title>Landing fixture</title>'
  )
})
await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
process.env.LANDING_INTERNAL_ORIGIN = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`
const { GET } = await import('@/app/route')
const { proxy } = await import('@/proxy')
const app = http.createServer(async (request, response) => {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers))
    if (typeof value === 'string') headers.set(name, value)
  const nextRequest = new NextRequest(`http://127.0.0.1${request.url}`, { headers })
  const decision = proxy(nextRequest)
  const result = decision.headers.has('location') ? decision : await GET(nextRequest, {})
  response.writeHead(result.status, Object.fromEntries(result.headers))
  response.end(Buffer.from(await result.arrayBuffer()))
})
await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${(app.address() as AddressInfo).port}`
const checks: { name: string; status: string; durationMs: number; error?: string }[] = []
async function check(name: string, execute: () => Promise<void>) {
  const start = performance.now()
  try {
    await execute()
    checks.push({ name, status: 'passed', durationMs: performance.now() - start })
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: performance.now() - start,
      error: getErrorMessage(error),
    })
  }
}
// boundary-raw-fetch: loopback HTTP verification with synthetic credentials only.
const request = (pathname = '/', headers?: HeadersInit) =>
  fetch(`${origin}${pathname}`, { redirect: 'manual', headers })
try {
  await check('Cookie hint redirects to session-validating app entry without caching', async () => {
    const response = await request('/', { Cookie: 'better-auth.session_token=synthetic' })
    assert.equal(response.status, 307)
    assert.equal(new URL(response.headers.get('location') || '').pathname, '/home')
    assert.match(response.headers.get('cache-control') || '', /no-store/)
  })
  if (hosted) {
    await check('Homepage strips credentials and upstream response headers', async () => {
      const response = await request('/?home&token=secret', {
        Cookie: 'better-auth.session_token=synthetic',
        Authorization: 'Bearer secret',
        'X-Forwarded-Host': 'attacker.example',
      })
      assert.equal(response.status, 200)
      assert.equal(receivedUrl, '/')
      for (const name of ['cookie', 'authorization', 'x-forwarded-host'])
        assert.equal(received?.[name], undefined)
      assert.equal(response.headers.get('set-cookie'), null)
      assert.equal(response.headers.get('access-control-allow-origin'), null)
      assert.match(response.headers.get('cache-control') || '', /no-store/)
      assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/)
    })
    for (const failure of ['redirect', 'error', 'json', 'oversize', 'slow']) {
      await check(`Fails closed for ${failure} upstream response`, async () => {
        mode = failure
        const response = await request()
        assert.equal(response.status, 503)
        assert.equal(redirected, false)
        assert.doesNotMatch(await response.text(), /internal-error-sentinel/)
      })
    }
  } else {
    await check('Anonymous self-hosted root redirects to auth even with ?home', async () => {
      const response = await request('/?home')
      assert.equal(response.status, 307)
      assert.equal(new URL(response.headers.get('location') || '').pathname, '/login')
      assert.equal(received, undefined)
    })
  }
} finally {
  app.closeAllConnections()
  upstream.closeAllConnections()
  await Promise.all([
    new Promise<void>((resolve) => app.close(() => resolve())),
    new Promise<void>((resolve) => upstream.close(() => resolve())),
  ])
  mkdirSync(path.dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, JSON.stringify(checks, null, 2))
}
assert(
  checks.every((check) => check.status === 'passed'),
  JSON.stringify(checks, null, 2)
)
