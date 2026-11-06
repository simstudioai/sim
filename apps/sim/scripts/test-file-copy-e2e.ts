import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { toArray, toRecord } from '@sim/utils/object'

const base = new URL(process.env.FILE_COPY_BASE_URL ?? 'http://127.0.0.1:3300')
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))
  throw new Error('File copy proof requires a disposable local runtime')
const fixtureDir = required(process.env.FILE_COPY_FIXTURE_DIR, 'FILE_COPY_FIXTURE_DIR is required')
const reportPath = required(process.env.FILE_COPY_REPORT_PATH, 'FILE_COPY_REPORT_PATH is required')
const workspaceId = required(
  process.env.FILE_COPY_WORKSPACE_ID,
  'FILE_COPY_WORKSPACE_ID is required'
)
const checks: { name: string; passed: boolean; durationMs: number; error?: string }[] = []
function required(value: unknown, message = 'Required fixture field missing'): string {
  if (typeof value !== 'string' || !value) throw new Error(message)
  return value
}
async function fixture(name: string) {
  return toRecord(JSON.parse(await readFile(join(fixtureDir, name), 'utf8')))
}
const keys = await fixture('v2-fixture-keys.json')
const cookie = toArray((await fixture('owner-account.json')).cookies)
  .map((value) => required(value).split(';')[0])
  .join('; ')
const projectId = required(toRecord((await fixture('http-project-fixture.json')).project).id)
type Owner = { entityType: 'workspace' | 'project'; entityId: string }
const workspaceOwner: Owner = { entityType: 'workspace', entityId: workspaceId }
const projectOwner: Owner = { entityType: 'project', entityId: projectId }
const created: { owner: Owner; fileIds: string[]; folderIds: string[] }[] = []
async function request(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  auth: 'personal' | 'workspace' | 'session' | 'none' = 'personal'
) {
  const headers = new Headers({ Origin: base.origin, 'Content-Type': 'application/json' })
  if (auth === 'session') headers.set('Cookie', cookie)
  if (auth === 'personal' || auth === 'workspace') headers.set('X-API-Key', required(keys[auth]))
  // boundary-raw-fetch: this proof exercises actual authenticated HTTP against a disposable local runtime.
  const response = await fetch(new URL(path, base), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  return { status: response.status, text: await response.text() }
}
function json(response: Awaited<ReturnType<typeof request>>, status = 200) {
  assert.equal(response.status, status, response.text.slice(0, 300))
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
const projectPrefix = `/api/v2/projects/${projectId}/files`
function selection(owner: Owner, fileIds: string[], folderIds: string[] = []) {
  return { owner, fileIds, folderIds }
}
function remember(owner: Owner, result: Record<string, unknown>) {
  const fileIds = toArray(result.files).map((file) => required(toRecord(file).id))
  const folderIds = toArray(result.folders).map((folder) => required(toRecord(folder).id))
  created.push({ owner, fileIds, folderIds })
  for (const file of toArray(result.files)) {
    assert.deepEqual(toRecord(file).owner, owner)
    assert.equal('key' in toRecord(file), false)
  }
  return { fileIds, folderIds }
}
try {
  const name = `copy-http-${generateId()}.txt`
  const content = 'Copy retains these source bytes.'
  const projectFile = toRecord(
    json(await request('POST', projectPrefix, { name, content }), 201).data
  )
  const workspaceFile = toRecord(
    json(await request('POST', '/api/v2/files', { workspaceId, name, content }), 201).data
  )
  created.push({ owner: projectOwner, fileIds: [required(projectFile.id)], folderIds: [] })
  created.push({ owner: workspaceOwner, fileIds: [required(workspaceFile.id)], folderIds: [] })
  const body = {
    source: selection(projectOwner, [required(projectFile.id)]),
    destination: { owner: workspaceOwner, folderId: null },
  }
  await check('copy requires a real API credential', async () => {
    const result = json(await request('POST', '/api/v2/files/copy', body, 'none'), 401)
    assert.equal(toRecord(result.error).code, 'UNAUTHORIZED')
  })
  await check('workspace keys cannot acquire compound owner authority', async () => {
    const result = json(await request('POST', '/api/v2/files/copy', body, 'workspace'), 403)
    assert.equal(toRecord(result.error).code, 'FORBIDDEN')
  })
  await check(
    'nested unknown fields and empty selections are rejected before copying',
    async () => {
      for (const invalid of [
        { ...body, source: { ...body.source, owner: { ...projectOwner, workspaceId } } },
        { ...body, source: selection(projectOwner, []) },
        {
          ...body,
          source: { ...body.source, owner: { entityType: 'organization', entityId: projectId } },
        },
      ]) {
        const result = json(await request('POST', '/api/v2/files/copy', invalid), 400)
        assert.equal(toRecord(result.error).code, 'BAD_REQUEST')
      }
    }
  )
  await check('v2 copies Project bytes to a separately authorized workspace', async () => {
    const result = toRecord(json(await request('POST', '/api/v2/files/copy', body), 201).data)
    const copied = remember(workspaceOwner, result)
    assert.equal(copied.fileIds.length, 1)
    assert.notEqual(copied.fileIds[0], projectFile.id)
    const read = await request(
      'GET',
      `/api/v2/files/${copied.fileIds[0]}?workspaceId=${workspaceId}`
    )
    assert.equal(read.status, 200)
    assert.equal(read.text, content)
    assert.equal((await request('GET', `${projectPrefix}/${projectFile.id}/content`)).text, content)
  })
  await check(
    'internal session copy uses the same compound workspace to Project behavior',
    async () => {
      const result = json(
        await request(
          'POST',
          '/api/files/copy',
          {
            source: selection(workspaceOwner, [required(workspaceFile.id)]),
            destination: { owner: projectOwner, folderId: null },
          },
          'session'
        ),
        201
      )
      const copied = remember(projectOwner, result)
      assert.equal(copied.fileIds.length, 1)
      const read = await request('GET', `${projectPrefix}/${copied.fileIds[0]}/content`)
      assert.equal(read.status, 200)
      assert.equal(read.text, content)
    }
  )
  await check('a file identity from another owner is concealed', async () => {
    const result = json(
      await request('POST', '/api/v2/files/copy', {
        ...body,
        source: selection(projectOwner, [required(workspaceFile.id)]),
      }),
      404
    )
    assert.equal(toRecord(result.error).code, 'NOT_FOUND')
  })
  await check(
    'recursive selected folder copy preserves nesting and excludes unselected siblings',
    async () => {
      const root = toRecord(
        json(
          await request(
            'POST',
            `/api/projects/${projectId}/files/folders`,
            {
              name: `tree-${generateId()}`,
            },
            'session'
          ),
          200
        ).folder
      )
      created.push({ owner: projectOwner, fileIds: [], folderIds: [required(root.id)] })
      const nested = toRecord(
        json(
          await request(
            'POST',
            `/api/projects/${projectId}/files/folders`,
            {
              name: 'nested',
              parentId: required(root.id),
            },
            'session'
          ),
          200
        ).folder
      )
      json(
        await request('POST', projectPrefix, {
          name: 'inside.txt',
          content: 'nested bytes',
          folderPath: `/${required(root.name)}/nested`,
        }),
        201
      )
      const result = toRecord(
        json(
          await request('POST', '/api/v2/files/copy', {
            source: selection(projectOwner, [], [required(root.id)]),
            destination: { owner: workspaceOwner, folderId: null },
          }),
          201
        ).data
      )
      const copied = remember(workspaceOwner, result)
      assert.equal(copied.fileIds.length, 1)
      assert.equal(copied.folderIds.length, 2)
      assert.equal(toRecord(toArray(result.files)[0]).name, 'inside.txt')
      assert.equal(
        toArray(result.folders).some((folder) => toRecord(folder).id === nested.id),
        false
      )
      assert.equal(
        (await request('GET', `/api/v2/files/${copied.fileIds[0]}?workspaceId=${workspaceId}`))
          .text,
        'nested bytes'
      )
    }
  )
} finally {
  for (const item of created.reverse()) {
    const path =
      item.owner.entityType === 'project'
        ? `/api/projects/${item.owner.entityId}/files/archive`
        : `/api/workspaces/${item.owner.entityId}/files/bulk-archive`
    await request('POST', path, { fileIds: item.fileIds, folderIds: item.folderIds }, 'session')
  }
}
if (checks.some((result) => !result.passed)) process.exitCode = 1
