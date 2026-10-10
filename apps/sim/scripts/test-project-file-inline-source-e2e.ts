import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getErrorMessage } from '@sim/utils/errors'
import { toArray, toRecord } from '@sim/utils/object'
import { createPublicFileContentSource } from '@/hooks/use-file-content-source'

const base = new URL(required(process.env.PROJECT_INLINE_SOURCE_BASE_URL))
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))
const fixturePath = required(process.env.PROJECT_INLINE_SOURCE_FIXTURE_PATH)
const reportPath = required(process.env.PROJECT_INLINE_SOURCE_REPORT_PATH)
const fixture = toRecord(JSON.parse(await readFile(fixturePath, 'utf8')))
const account = toRecord(
  JSON.parse(await readFile(join(dirname(fixturePath), 'owner-account.json'), 'utf8'))
)
const cookie = toArray(account.cookies)
  .map((value) => required(value).split(';')[0])
  .join('; ')
const doc = toRecord(toArray(fixture.files).find((value) => toRecord(value).owner === 'project'))
const foreign = toRecord(fixture.wrongOwner)
const owner = { entityType: 'project', entityId: required(fixture.projectId) } as const
const token = required(doc.token)
const contentPath = `/api/files/public/${token}/content`
const ownPath = `/api/projects/${owner.entityId}/files/${required(doc.imageId)}/content`
const foreignPath = `/api/projects/${required(foreign.projectId)}/files/${required(foreign.fileId)}/content`
const publicSource = createPublicFileContentSource(token, contentPath, owner)
const checks: { name: string; passed: boolean; durationMs: number; error?: string }[] = []

function required(value: unknown): string {
  assert.ok(typeof value === 'string' && value, 'Required fixture or environment field missing')
  return value
}
async function request(path: string, authenticated = false) {
  // boundary-raw-fetch: this proof pairs the actual browser source adapter with real private and public image delivery.
  return fetch(new URL(path, base), {
    headers: { ...(authenticated ? { Cookie: cookie } : {}), 'X-Forwarded-For': '203.0.113.242' },
    signal: AbortSignal.timeout(90_000),
  })
}
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
}

await check(
  'The foreign image exists and the signed-in viewer can read its private URL',
  async () => {
    const response = await request(foreignPath, true)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.ok((await response.arrayBuffer()).byteLength > 0)
  }
)
await check('Private Project inline responses disable browser cache reuse', async () => {
  const metadata = await request(
    `/api/projects/${owner.entityId}/files/${required(doc.imageId)}`,
    true
  )
  assert.equal(metadata.status, 200)
  const key = required(toRecord(toRecord(await metadata.json()).file).key)
  for (const query of [
    `key=${encodeURIComponent(key)}`,
    `fileId=${encodeURIComponent(required(doc.imageId))}`,
  ]) {
    const response = await request(`/api/projects/${owner.entityId}/files/inline?${query}`, true)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.ok((await response.arrayBuffer()).byteLength > 0)
  }
})
await check(
  'The document token grants its own image and conceals the foreign Project image',
  async () => {
    assert.equal(
      (await request(`/api/files/public/${token}/inline?fileId=${required(doc.imageId)}`)).status,
      200
    )
    assert.equal(
      (await request(`/api/files/public/${token}/inline?fileId=${required(foreign.fileId)}`))
        .status,
      404
    )
    const response = await request(contentPath)
    assert.equal(response.status, 200)
    assert.ok(
      (await response.text()).includes(foreignPath),
      'Fixture must actually embed the foreign private URL'
    )
  }
)
await check(
  'Canonical and private same-owner image references stay on the public token pipeline',
  async () => {
    const expected = `/api/files/public/${token}/inline?fileId=${required(doc.imageId)}`
    assert.equal(publicSource.resolveImageSrc(ownPath), expected)
    assert.equal(
      publicSource.resolveImageSrc(`sim:file/${required(doc.imageId)}?project=${owner.entityId}`),
      expected
    )
  }
)
await check('Public sources omit foreign-owner private image URLs', async () => {
  assert.equal(publicSource.resolveImageSrc(foreignPath), undefined)
})

await mkdir(dirname(reportPath), { recursive: true })
await writeFile(
  reportPath,
  JSON.stringify(
    {
      boundary:
        'Real browser source adapter plus actual HTTP; native browser screenshot remains a separate check',
      checks,
    },
    null,
    2
  )
)
process.exitCode = checks.some((check) => !check.passed) ? 1 : 0
