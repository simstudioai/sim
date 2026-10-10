import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { toArray, toRecord } from '@sim/utils/object'

const base = new URL(process.env.PROJECT_FILE_BROWSER_BASE_URL ?? 'http://127.0.0.1:3300')
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))
  throw new Error('Browser proof requires a disposable local runtime')
function required(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Required fixture field missing')
  return value
}
const reportPath = required(process.env.PROJECT_FILE_BROWSER_REPORT_PATH)
const fixtureDir = required(process.env.PROJECT_FILE_BROWSER_FIXTURE_DIR)
const fixture = toRecord(
  JSON.parse(await readFile(join(fixtureDir, 'http-project-fixture.json'), 'utf8'))
)
const account = toRecord(JSON.parse(await readFile(join(fixtureDir, 'owner-account.json'), 'utf8')))
const cookie = toArray(account.cookies)
  .map((cookie) => required(cookie).split(';')[0])
  .join('; ')
const projectId = required(toRecord(fixture.project).id)
const prefix = `/api/projects/${projectId}/files`
const checks: { name: string; passed: boolean; durationMs: number; error?: string }[] = []
let folderId: string | undefined
let secondProjectId: string | undefined
async function request(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  anonymous = false
) {
  // boundary-raw-fetch: this repeatable proof exercises actual session-authenticated HTTP against the disposable local app.
  const response = await fetch(new URL(path, base), {
    method,
    headers: {
      Origin: base.origin,
      'Content-Type': 'application/json',
      ...(anonymous ? {} : { Cookie: cookie }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  })
  return { status: response.status, text: await response.text() }
}
function json(response: Awaited<ReturnType<typeof request>>, status = 200) {
  assert.equal(response.status, status, response.text)
  return toRecord(JSON.parse(response.text))
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
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
}
function listPath(query: Record<string, string | string[]>, project = projectId) {
  const params = new URLSearchParams({
    folderId: required(folderId),
    limit: '1',
    sortBy: 'name',
    sortOrder: 'asc',
  })
  for (const [key, value] of Object.entries(query)) {
    params.delete(key)
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item)
  }
  return `/api/projects/${project}/files?${params}`
}
try {
  const record = toRecord(json(await request('GET', `/api/projects/${projectId}`)).project)
  const second = json(
    await request('POST', '/api/projects', {
      organizationId: record.organizationId,
      name: `Browser cursor ${generateId()}`,
      initialEnvironment: { name: 'Sandbox' },
    }),
    201
  )
  secondProjectId = required(toRecord(second.project).id)
  folderId = required(
    toRecord(
      json(await request('POST', `${prefix}/folders`, { name: `Browser proof ${generateId()}` }))
        .folder
    ).id
  )
  const created = new Map<string, string>()
  for (const name of ['a.txt', 'b.txt', 'c.txt', 'y.png', 'z.png']) {
    const file = toRecord(
      json(
        await request('POST', prefix, {
          name,
          content: 'x',
          contentType: 'application/octet-stream',
          encoding: 'utf-8',
          folderId,
        }),
        201
      ).file
    )
    created.set(name, required(file.id))
  }
  await check('complete-set type filter finds later matches with a one-row page', async () => {
    const first = json(await request('GET', listPath({ types: 'image' })))
    assert.deepEqual(
      toArray(first.items).map((item) => toRecord(item).id),
      [created.get('y.png')]
    )
    const second = json(
      await request('GET', listPath({ types: 'image', cursor: required(first.nextCursor) }))
    )
    assert.deepEqual(
      toArray(second.items).map((item) => toRecord(item).id),
      [created.get('z.png')]
    )
    assert.equal(second.nextCursor, null)
  })
  await check('equal size keys retain ascending names across both cursor directions', async () => {
    for (const sortOrder of ['asc', 'desc']) {
      const ids: string[] = []
      let cursor: string | undefined
      for (let page = 0; page < 6; page++) {
        const result = json(
          await request(
            'GET',
            listPath({ sortBy: 'size', sortOrder, ...(cursor ? { cursor } : {}) })
          )
        )
        ids.push(...toArray(result.items).map((item) => required(toRecord(item).id)))
        if (!result.nextCursor) break
        cursor = required(result.nextCursor)
      }
      assert.deepEqual(ids, [...created.values()])
    }
  })
  const first = json(await request('GET', listPath({})))
  const cursor = required(first.nextCursor)
  await check('a cursor cannot cross a filter or folder scope', async () => {
    assert.equal((await request('GET', listPath({ cursor, types: 'image' }))).status, 400)
    assert.equal((await request('GET', listPath({ cursor, creatorIds: generateId() }))).status, 400)
    assert.equal((await request('GET', listPath({ cursor, folderId: generateId() }))).status, 400)
  })
  await check('a cursor cannot cross an accessible Project or ordering', async () => {
    assert.equal(
      (await request('GET', listPath({ cursor }, required(secondProjectId)))).status,
      400
    )
    assert.equal((await request('GET', listPath({ cursor, sortOrder: 'desc' }))).status, 400)
    assert.equal((await request('GET', listPath({ cursor, sortBy: 'size' }))).status, 400)
  })
  await check('equivalent unordered filter sets preserve cursor continuity', async () => {
    const first = json(await request('GET', listPath({ types: ['image', 'video'] })))
    const second = json(
      await request(
        'GET',
        listPath({ types: ['video', 'image'], cursor: required(first.nextCursor) })
      )
    )
    assert.equal(toRecord(toArray(second.items)[0]).id, created.get('z.png'))
  })
  await check(
    'browser list requires a session and reports observed canonical creator labels',
    async () => {
      assert.equal((await request('GET', listPath({}), undefined, true)).status, 401)
      const page = json(await request('GET', listPath({ limit: '100' })))
      for (const item of toArray(page.items)) {
        const creator = toRecord(toRecord(item).creator)
        assert.equal(typeof creator.name, 'string')
        assert.equal(creator.deleted, false)
        assert.equal('environmentIds' in creator, false)
        assert.equal('permissions' in creator, false)
      }
      assert.equal(toArray(page.items).length, created.size)
    }
  )
} catch (error) {
  checks.push({
    name: 'fixture setup',
    passed: false,
    durationMs: 0,
    error: getErrorMessage(error),
  })
} finally {
  await check('fixture resources are archived', async () => {
    if (folderId)
      json(await request('POST', `${prefix}/archive`, { fileIds: [], folderIds: [folderId] }))
    if (secondProjectId) json(await request('DELETE', `/api/projects/${secondProjectId}`))
  })
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
}
process.stdout.write(
  `${JSON.stringify({ passed: checks.filter((check) => check.passed).length, total: checks.length, report: reportPath })}\n`
)
if (checks.some((check) => !check.passed)) process.exitCode = 1
