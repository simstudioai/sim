import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { toArray, toRecord } from '@sim/utils/object'

const base = new URL(process.env.PROJECT_FILE_HISTORY_BASE_URL ?? 'http://127.0.0.1:3300')
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))
  throw new Error('History proof requires a disposable local runtime')
const fixtureDir = required(process.env.PROJECT_FILE_HISTORY_FIXTURE_DIR)
const reportPath = required(
  process.env.PROJECT_FILE_HISTORY_REPORT_PATH,
  'PROJECT_FILE_HISTORY_REPORT_PATH is required'
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
const projectFixture = await fixture('http-project-fixture.json')
const projectId = required(toRecord(projectFixture.project).id)
const workspaceId = required(toRecord(projectFixture.initialEnvironment).id)
const prefix = `/api/v2/projects/${projectId}/files`
const internalPrefix = `/api/projects/${projectId}/files`
const ids: string[] = []
const workspaceIds: string[] = []
const pendingUploads: { id: string; token: string }[] = []
async function request(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  auth: 'personal' | 'workspace' | 'session' | 'none' = 'personal',
  extraHeaders?: Record<string, string>
) {
  const headers = new Headers({ Origin: base.origin, 'Content-Type': 'application/json' })
  if (auth === 'session') headers.set('Cookie', cookie)
  if (auth === 'personal' || auth === 'workspace') headers.set('X-API-Key', required(keys[auth]))
  for (const [key, value] of Object.entries(extraHeaders ?? {})) headers.set(key, value)
  // boundary-raw-fetch: this standalone proof exercises real authenticated HTTP against a disposable local runtime.
  const response = await fetch(new URL(path, base), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  })
  return { status: response.status, headers: response.headers, text: await response.text() }
}
function json(response: Awaited<ReturnType<typeof request>>, status = 200) {
  assert.equal(response.status, status)
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
try {
  const create = async (content: string) => {
    const file = toRecord(
      json(
        await request('POST', prefix, {
          name: `history-${generateId()}.txt`,
          content,
          contentType: 'text/plain',
          encoding: 'utf-8',
        }),
        201
      ).data
    )
    ids.push(required(file.id))
    return file
  }
  const created = await create('alpha')
  const other = await create('other')
  const detail = `${prefix}/${required(created.id)}`
  const internal = `${internalPrefix}/${required(created.id)}`
  const saved = toRecord(
    json(
      await request('PUT', `${detail}/content`, {
        content: 'beta',
        encoding: 'utf-8',
        expectedRevision: created.revision,
      })
    ).data
  )
  json(
    await request(
      'PUT',
      `${internal}/content`,
      { content: 'gamma', encoding: 'utf-8', expectedRevision: saved.revision },
      'session'
    )
  )
  const current = toRecord(json(await request('GET', `${detail}/metadata`)).data)
  let cursor: string | undefined
  await check('v2 pages preserve source and authorized author attribution', async () => {
    const first = json(await request('GET', `${detail}/versions?limit=1`))
    const head = toRecord(toArray(first.data)[0])
    assert.equal(head.version, 3)
    assert.equal(head.source, 'user')
    assert.equal(typeof toRecord(toArray(head.authors)[0]).email, 'string')
    assert.equal('key' in head, false)
    assert.equal('authorUserIds' in head, false)
    cursor = required(first.nextCursor)
    const second = json(
      await request('GET', `${detail}/versions?limit=1&cursor=${encodeURIComponent(cursor)}`)
    )
    assert.equal(toRecord(toArray(second.data)[0]).version, 2)
    assert.equal(toRecord(toArray(second.data)[0]).source, 'api')
    const third = json(
      await request(
        'GET',
        `${detail}/versions?limit=1&cursor=${encodeURIComponent(required(second.nextCursor))}`
      )
    )
    assert.equal(toRecord(toArray(third.data)[0]).version, 1)
    assert.equal(third.nextCursor, null)
  })
  await check('history cursors cannot cross file or ordering', async () => {
    assert.ok(cursor)
    assert.equal(
      (
        await request(
          'GET',
          `${prefix}/${required(other.id)}/versions?cursor=${encodeURIComponent(cursor)}`
        )
      ).status,
      400
    )
    assert.equal(
      (
        await request(
          'GET',
          `${detail}/versions?sortOrder=asc&cursor=${encodeURIComponent(cursor)}`
        )
      ).status,
      400
    )
  })
  await check('internal session list and metadata share authorized history', async () => {
    const list = json(await request('GET', `${internal}/versions?limit=2`, undefined, 'session'))
    assert.equal(toArray(list.versions).length, 2)
    assert.equal(list.revision, current.revision)
    const version = toRecord(
      json(await request('GET', `${internal}/versions/1`, undefined, 'session')).version
    )
    assert.equal(version.version, 1)
    assert.equal(version.source, 'upload')
  })
  await check('both surfaces deliver historical source bytes privately', async () => {
    for (const [path, auth] of [
      [`${detail}/versions/1/content`, 'personal'],
      [`${internal}/versions/1/content`, 'session'],
    ] as const) {
      const response = await request('GET', path, undefined, auth)
      assert.equal(response.status, 200)
      assert.equal(response.text, 'alpha')
      assert.match(response.headers.get('cache-control') ?? '', /private/)
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    }
  })
  await check('workspace keys and anonymous sessions cannot use Project history', async () => {
    for (const [method, path, body] of [
      ['GET', `${detail}/versions`, undefined],
      ['GET', `${detail}/versions/1/content`, undefined],
      ['POST', `${detail}/versions/1/revert`, {}],
      ['DELETE', `${detail}/versions/1`, undefined],
    ] as const)
      assert.equal((await request(method, path, body, 'workspace')).status, 403)
    assert.equal((await request('GET', `${internal}/versions`, undefined, 'none')).status, 401)
  })
  await check('revert rejects stale content and appends a source-attributed version', async () => {
    assert.equal(
      (await request('POST', `${detail}/versions/1/revert`, { expectedRevision: created.revision }))
        .status,
      409
    )
    const result = toRecord(
      json(
        await request('POST', `${detail}/versions/1/revert`, {
          expectedRevision: current.revision,
          expectedCurrentVersion: 3,
        })
      ).data
    )
    assert.equal(result.reverted, true)
    assert.equal(toRecord(result.version).version, 4)
    assert.equal(toRecord(result.version).source, 'revert')
    assert.equal(toRecord(result.version).restoredFromVersion, 1)
    assert.notEqual(result.revision, current.revision)
    assert.equal((await request('GET', `${detail}/content`)).text, 'alpha')
    assert.equal(
      (await request('POST', `${detail}/versions/2/revert`, { expectedRevision: current.revision }))
        .status,
      409
    )
  })
  await check('current history survives while a superseded version can be deleted', async () => {
    assert.equal((await request('DELETE', `${detail}/versions/4`)).status, 409)
    assert.equal(
      json(await request('DELETE', `${internal}/versions/2`, undefined, 'session')).deleted,
      true
    )
    assert.equal((await request('GET', `${detail}/versions/2`)).status, 404)
    assert.equal((await request('GET', `${detail}/content`)).text, 'alpha')
  })
  await check('history validates pagination and conceals foreign ownership', async () => {
    assert.equal((await request('GET', `${detail}/versions?limit=1.5`)).status, 400)
    assert.equal((await request('GET', `${detail}/versions?workspaceId=forged`)).status, 400)
    assert.equal(
      (
        await request(
          'GET',
          `/api/v2/projects/${generateId()}/files/${required(created.id)}/versions`
        )
      ).status,
      404
    )
  })
  await check(
    'workspace session history preserves source bytes and rejects foreign ownership',
    async () => {
      const file = toRecord(
        json(
          await request('POST', '/api/v2/files', {
            workspaceId,
            name: `workspace-history-${generateId()}.txt`,
            content: 'workspace original',
          }),
          201
        ).data
      )
      const fileId = required(file.id)
      workspaceIds.push(fileId)
      const path = `/api/workspaces/${workspaceId}/files/${fileId}/versions`
      const list = json(await request('GET', path, undefined, 'session'))
      assert.equal(list.revision, file.revision)
      assert.equal(toRecord(toArray(list.versions)[0]).version, 1)
      assert.equal('key' in toRecord(toArray(list.versions)[0]), false)
      const source = await request('GET', `${path}/1/content`, undefined, 'session')
      assert.equal(source.status, 200)
      assert.equal(source.text, 'workspace original')
      assert.match(source.headers.get('cache-control') ?? '', /private/)
      assert.equal((await request('GET', path, undefined, 'none')).status, 401)
      assert.equal(
        (
          await request(
            'GET',
            `/api/workspaces/${generateId()}/files/${fileId}/versions`,
            undefined,
            'session'
          )
        ).status,
        404
      )
      assert.equal(
        (
          await request(
            'GET',
            `/api/workspaces/${workspaceId}/files/${required(created.id)}/versions`,
            undefined,
            'session'
          )
        ).status,
        404
      )
    }
  )
  await check(
    'workspace session revert fences the observed history revision and retains later versions',
    async () => {
      const fileId = required(workspaceIds[0])
      const path = `/api/workspaces/${workspaceId}/files/${fileId}/versions`
      const observed = json(await request('GET', path, undefined, 'session'))
      const saved = toRecord(
        json(
          await request('PUT', `/api/v2/files/${fileId}/content`, {
            workspaceId,
            content: 'workspace concurrent save',
            expectedRevision: observed.revision,
          })
        ).data
      )
      assert.equal(
        (
          await request(
            'POST',
            `${path}/1/revert`,
            { expectedRevision: observed.revision },
            'session'
          )
        ).status,
        409
      )
      const head = json(await request('GET', path, undefined, 'session'))
      assert.equal(head.revision, saved.revision)
      const reverted = json(
        await request('POST', `${path}/1/revert`, { expectedRevision: head.revision }, 'session')
      )
      assert.equal(reverted.reverted, true)
      assert.notEqual(reverted.revision, head.revision)
      assert.equal(
        (await request('GET', `/api/v2/files/${fileId}?workspaceId=${workspaceId}`)).text,
        'workspace original'
      )
      const retained = await request('GET', `${path}/2/content`, undefined, 'session')
      assert.equal(retained.status, 200)
      assert.equal(retained.text, 'workspace concurrent save')
      assert.equal(
        toRecord(toArray(json(await request('GET', path, undefined, 'session')).versions)[0])
          .source,
        'revert'
      )
    }
  )
  await check(
    'oversized historical bytes return 413 without changing the current head',
    async () => {
      const bytes = Buffer.alloc(100 * 1024 * 1024 + 1)
      const upload = json(
        await request(
          'POST',
          `${internalPrefix}/uploads`,
          {
            name: `history-size-${generateId()}.bin`,
            contentType: 'application/octet-stream',
            size: bytes.length,
          },
          'session'
        ),
        201
      )
      const transfer = toRecord(upload.transfer)
      const uploadId = required(toRecord(upload.session).id)
      const uploadToken = required(upload.uploadToken)
      pendingUploads.push({ id: uploadId, token: uploadToken })
      assert.equal(transfer.method, 'multipart')
      const partSize = transfer.partSize
      const partCount = transfer.partCount
      assert.equal(typeof partSize, 'number')
      assert.equal(typeof partCount, 'number')
      if (typeof partSize !== 'number' || typeof partCount !== 'number')
        throw new Error('Multipart transfer sizes are missing')
      assert.equal(partCount, Math.ceil(bytes.length / partSize))
      assert.ok(partCount <= 100)
      const partNumbers = Array.from({ length: partCount }, (_, index) => index + 1)
      const parts = toArray(
        json(
          await request(
            'POST',
            `${internalPrefix}/uploads/${uploadId}/parts`,
            { partNumbers },
            'session',
            { 'upload-token': uploadToken }
          )
        ).parts
      )
      assert.equal(parts.length, partCount)
      for (const value of parts) {
        const part = toRecord(value)
        const partNumber = part.partNumber
        if (typeof partNumber !== 'number') throw new Error('Multipart part number is missing')
        const transferHeaders = new Headers()
        for (const [key, header] of Object.entries(toRecord(part.headers)))
          transferHeaders.set(key, required(header))
        // boundary-raw-fetch: this proof uploads actual oversized history through signed multipart transfer URLs.
        const transferred: Response = await fetch(required(part.url), {
          method: 'PUT',
          headers: transferHeaders,
          body: bytes.subarray((partNumber - 1) * partSize, partNumber * partSize),
          signal: AbortSignal.timeout(90_000),
        })
        assert.equal(transferred.ok, true)
      }
      const completed = json(
        await request('POST', `${internalPrefix}/uploads/${uploadId}/complete`, {}, 'session', {
          'upload-token': uploadToken,
        })
      )
      const fileId = required(toRecord(completed.result).id)
      ids.push(fileId)
      const largeDetail = `${prefix}/${fileId}`
      const largeInternal = `${internalPrefix}/${fileId}`
      const initial = toRecord(json(await request('GET', `${largeDetail}/metadata`)).data)
      const small = toRecord(
        json(
          await request('PUT', `${largeDetail}/content`, {
            content: 'small replacement',
            encoding: 'utf-8',
            expectedRevision: initial.revision,
          })
        ).data
      )
      const statuses: number[] = []
      for (const [path, auth] of [
        [largeDetail, 'personal'],
        [largeInternal, 'session'],
      ] as const) {
        statuses.push((await request('GET', `${path}/versions/1/content`, undefined, auth)).status)
        statuses.push(
          (
            await request(
              'POST',
              `${path}/versions/1/revert`,
              { expectedRevision: small.revision },
              auth
            )
          ).status
        )
      }
      assert.deepEqual(statuses, [413, 413, 413, 413])
      assert.equal(
        toRecord(json(await request('GET', `${largeDetail}/metadata`)).data).revision,
        small.revision
      )
      assert.equal((await request('GET', `${largeDetail}/content`)).text, 'small replacement')
    }
  )
} finally {
  if (ids.length) await request('POST', `${prefix}/archive`, { fileIds: ids })
  if (workspaceIds.length)
    await request(
      'POST',
      `/api/workspaces/${workspaceId}/files/bulk-archive`,
      { fileIds: workspaceIds, folderIds: [] },
      'session'
    )
  for (const upload of pendingUploads)
    await request('DELETE', `${internalPrefix}/uploads/${upload.id}`, undefined, 'session', {
      'upload-token': upload.token,
    })
}
process.stdout.write(
  `${JSON.stringify({ passed: checks.filter((check) => check.passed).length, total: checks.length, report: reportPath })}\n`
)
process.exitCode = checks.every((check) => check.passed) ? 0 : 1
