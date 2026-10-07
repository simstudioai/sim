import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { chromium } from '@playwright/test'
import { getErrorMessage } from '@sim/utils/errors'
import { toArray, toRecord } from '@sim/utils/object'
import JSZip from 'jszip'

const required = (value: unknown): string => {
  assert.ok(typeof value === 'string' && value.length > 0, 'Missing delivery fixture setting')
  return value
}
const base = new URL(required(process.env.FILE_DELIVERY_BASE_URL))
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname))
const directory = required(process.env.FILE_DELIVERY_FIXTURE_DIR)
const reportPath = required(process.env.FILE_DELIVERY_REPORT_PATH)
const fixture = toRecord(
  JSON.parse(await readFile(join(directory, 'http-project-fixture.json'), 'utf8'))
)
const account = toRecord(JSON.parse(await readFile(join(directory, 'owner-account.json'), 'utf8')))
const personalKey = required(
  toRecord(JSON.parse(await readFile(join(directory, 'v2-fixture-keys.json'), 'utf8'))).personal
)
const cookie = toArray(account.cookies)
  .map((value) => required(value).split(';')[0])
  .join('; ')
const projectId = required(toRecord(fixture.project).id)
const workspaceId = required(toRecord(fixture.initialEnvironment).id)
const responses: {
  path: string
  method: string
  status: number
  headers: Record<string, string | null>
}[] = []
const checks: { name: string; passed: boolean; durationMs: number; error?: string }[] = []
async function check(name: string, run: () => Promise<void>) {
  const start = performance.now()
  try {
    await run()
    checks.push({ name, passed: true, durationMs: performance.now() - start })
  } catch (error) {
    checks.push({
      name,
      passed: false,
      durationMs: performance.now() - start,
      error: getErrorMessage(error),
    })
  }
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks, responses }, null, 2))
}
async function request(path: string, init: RequestInit = {}, anonymous = false) {
  // boundary-raw-fetch: exercises real local binary HTTP responses and their security/cache headers.
  const response = await fetch(new URL(path, base), {
    ...init,
    headers: {
      Origin: base.origin,
      'Content-Type': 'application/json',
      ...(anonymous ? {} : { Cookie: cookie }),
      ...init.headers,
    },
    signal: AbortSignal.timeout(120_000),
  })
  responses.push({
    path,
    method: init.method ?? 'GET',
    status: response.status,
    headers: {
      'content-security-policy': response.headers.get('content-security-policy'),
      'content-type': response.headers.get('content-type'),
      'content-disposition': response.headers.get('content-disposition'),
      'cache-control': response.headers.get('cache-control'),
      etag: response.headers.get('etag'),
      'x-content-type-options': response.headers.get('x-content-type-options'),
      'x-frame-options': response.headers.get('x-frame-options'),
    },
  })
  return response
}
async function create(
  owner: 'workspace' | 'project',
  name: string,
  contentType: string,
  content: string
) {
  const response = await request(
    `/api/${owner === 'workspace' ? `workspaces/${workspaceId}` : `projects/${projectId}`}/files`,
    { method: 'POST', body: JSON.stringify({ name, contentType, content, encoding: 'utf-8' }) }
  )
  assert.ok(response.ok, `Create returned ${response.status}: ${await response.clone().text()}`)
  return toRecord(toRecord(await response.json()).file)
}
const prefix = `/api/projects/${projectId}/files`
await check(
  'Project representation headers, Unicode names, active MIME and HEAD without generation',
  async () => {
    for (const [name, type, content] of [
      [
        'résumé.svg',
        'image/svg+xml',
        '<svg xmlns="http://www.w3.org/2000/svg" onload="globalThis.deliveryExecuted=true"/>',
      ],
      ['unsafe.html', 'text/html', '<script>globalThis.deliveryExecuted=true</script>'],
      ['code.js', 'application/javascript', 'globalThis.deliveryExecuted=true'],
      ['mismatch.txt', 'text/html', '<script>globalThis.deliveryExecuted=true</script>'],
    ]) {
      const file = await create('project', name, type, content)
      const path = `${prefix}/${required(file.id)}/content`
      const response = await request(path)
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'private, no-store')
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
      if (name.endsWith('.svg'))
        assert.match(response.headers.get('content-security-policy') ?? '', /sandbox/)
      if (name.endsWith('.html') || name.endsWith('.js'))
        assert.match(response.headers.get('content-disposition') ?? '', /^attachment;/)
      if (!name.endsWith('.svg'))
        assert.match(response.headers.get('content-security-policy') ?? '', /default-src/)
      const download = await request(`${prefix}/download?fileIds=${required(file.id)}`)
      assert.equal(download.status, 200)
      assert.match(download.headers.get('content-disposition') ?? '', /^attachment;/)
      assert.match(download.headers.get('content-security-policy') ?? '', /default-src/)
      const archive = await JSZip.loadAsync(await download.arrayBuffer())
      assert.equal(await archive.file(required(file.name))?.async('string'), content)
      const head = await request(path, { method: 'HEAD' })
      assert.equal(head.status, 200)
      assert.equal(await head.text(), '')
      assert.equal(head.headers.get('cache-control'), 'private, no-store')
      const denied = await request(path, { method: 'HEAD' }, true)
      assert.equal(denied.status, 401)
      assert.equal(denied.headers.get('content-disposition'), null)
      assert.match(denied.headers.get('content-security-policy') ?? '', /default-src/)
      const bypass = await request(`/api/files/serve/${required(file.key)}`)
      assert.equal(bypass.status, 404)
    }
    const generated = await create(
      'project',
      'head.pdf',
      'text/x-pdflibjs',
      'throw new Error("HEAD must never execute this source")'
    )
    const head = await request(`${prefix}/${required(generated.id)}/artifact`, { method: 'HEAD' })
    assert.equal(head.status, 200)
  }
)
await check(
  'v2 Project SVG delivery and current, retained, missing and generated HEAD admission',
  async () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"/>'
    const file = await create('project', 'v2-sandbox.svg', 'image/svg+xml', source)
    const detail = `/api/v2/projects/${projectId}/files/${required(file.id)}`
    const headers = { 'X-API-Key': personalKey }
    const response = await request(`${detail}/content`, { headers }, true)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), source)
    assert.match(response.headers.get('content-security-policy') ?? '', /sandbox/)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    const updated = await request(
      `${detail}/content`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          content: `${source}\n`,
          encoding: 'utf-8',
          expectedRevision: required(file.revision),
        }),
      },
      true
    )
    assert.equal(updated.status, 200)
    for (const suffix of ['/content', '/versions/1/content']) {
      const head = await request(`${detail}${suffix}`, { method: 'HEAD', headers }, true)
      assert.equal(head.status, 200)
      assert.equal(await head.text(), '')
      assert.equal(head.headers.get('cache-control'), 'private, no-store')
      const denied = await request(`${detail}${suffix}`, { method: 'HEAD' }, true)
      assert.equal(denied.status, 401)
      assert.equal(denied.headers.get('content-disposition'), null)
    }
    const missing = await request(
      `${detail}/versions/999999/content`,
      { method: 'HEAD', headers },
      true
    )
    assert.equal(missing.status, 404)
    const generated = await create(
      'project',
      'v2-head.pdf',
      'text/x-pdflibjs',
      'throw new Error("HEAD must not compile")'
    )
    for (const path of [
      `/api/v2/projects/${projectId}/files/${required(generated.id)}/content`,
      `/api/v2/projects/${projectId}/files/bulk-download?fileIds=${required(generated.id)}`,
    ]) {
      const head = await request(path, { method: 'HEAD', headers }, true)
      assert.equal(head.status, 200)
      assert.equal(await head.text(), '')
      assert.equal(head.headers.get('cache-control'), 'private, no-store')
    }
  }
)
await check('Workspace immutable URLs, authorized 304 and browser cache reuse', async () => {
  const file = await create('workspace', 'cache.txt', 'text/plain', 'workspace cache bytes')
  const path = `/api/files/serve/${required(file.key)}`
  const first = await request(path)
  assert.equal(first.status, 200)
  const etag = required(first.headers.get('etag'))
  const conditional = await request(path, { headers: { 'If-None-Match': etag } })
  assert.equal(conditional.status, 304)
  assert.equal(conditional.headers.get('x-content-type-options'), 'nosniff')
  const denied = await request(path, { headers: { 'If-None-Match': etag } }, true)
  assert.equal(denied.status, 401)
  const immutable = await request(`${path}?v=1`)
  assert.equal(immutable.headers.get('cache-control'), 'private, max-age=31536000, immutable')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const context = await browser.newContext()
    await context.addCookies(
      cookie.split('; ').map((entry) => ({
        name: entry.slice(0, entry.indexOf('=')),
        value: entry.slice(entry.indexOf('=') + 1),
        url: base.origin,
      }))
    )
    const page = await context.newPage()
    await page.goto(new URL('/api/health', base).href)
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable')
    const cached: string[] = []
    cdp.on('Network.requestServedFromCache', (event) => cached.push(event.requestId))
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await page.evaluate(
        async (url) => (await fetch(url)).text(),
        `${path}?v=browser`
      )
      assert.equal(text, 'workspace cache bytes')
    }
    const timing = await page.evaluate(() =>
      performance.getEntriesByType('resource').map((entry) => {
        const resource = entry as PerformanceResourceTiming
        return {
          name: resource.name,
          transferSize: resource.transferSize,
          encodedBodySize: resource.encodedBodySize,
        }
      })
    )
    await writeFile(`${reportPath}.cache.json`, JSON.stringify({ cached, timing }, null, 2))
    assert.ok(
      cached.length > 0 ||
        timing
          .filter((entry) => entry.name.endsWith('?v=browser'))
          .some((entry) => entry.transferSize === 0 && entry.encodedBodySize > 0),
      'Second browser fetch must use its private cache'
    )
    const svg = await create(
      'workspace',
      'sandbox.svg',
      'image/svg+xml',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="globalThis.deliveryExecuted=true"/>'
    )
    await page.goto(new URL(`/api/files/serve/${required(svg.key)}`, base).href)
    assert.equal(await page.evaluate('globalThis.deliveryExecuted'), undefined)
    await page.screenshot({ path: `${reportPath}.svg.png` })
  } finally {
    await browser.close()
  }
})
await check('Nonfile and file JSON responses retain the application CSP', async () => {
  for (const path of ['/api/health', prefix]) {
    const response = await request(path)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-security-policy') ?? '', /default-src/)
    assert.doesNotMatch(response.headers.get('content-security-policy') ?? '', /sandbox/)
  }
})
if (checks.some((check) => !check.passed)) process.exitCode = 1
