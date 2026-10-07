import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId, generateShortId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { makeSignature } from 'better-auth/crypto'
import postgres from 'postgres'
import { getKnowledgeBaseContract } from '@/lib/api/contracts/knowledge'
import { getTableContract } from '@/lib/api/contracts/tables'
import { readWorkspaceFileContract } from '@/lib/api/contracts/workspace-files'

/** Real HTTP lifecycle exercise; SQL seeds identities, access fixtures, and a provider-independent document. */
const logger = createLogger('SharedResourceLifecycleE2E')
function required(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly supplied`)
  return value
}
const baseUrl = new URL(required('LIFECYCLE_E2E_BASE_URL'))
assert(['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname))
assert.equal(baseUrl.protocol, 'http:')
const databaseUrl = assertDisposableTestDatabaseUrl(required('LIFECYCLE_E2E_DATABASE_URL'))
const authSecret = required('LIFECYCLE_E2E_AUTH_SECRET')
const adminKey = required('LIFECYCLE_E2E_ADMIN_KEY')
const reportPath = required('LIFECYCLE_E2E_REPORT_PATH')
const sql = postgres(databaseUrl.toString(), { max: 2 })
const ownerKey = `sk-sim-fixture-${generateId()}`
const ownerId = generateId()
const departingId = generateId()
const workspaceId = generateId()
const cookies = new Map<string, string>()
const checks: { name: string; status: string; durationMs: number; error?: string }[] = []
const requests: { method: string; path: string; status: number }[] = []
const startedAt = new Date().toISOString()
let fileId = ''
let folderId = ''
let tableId = ''
let kbId = ''
const documentId = generateId()

function record(value: unknown): Record<string, unknown> {
  assert(isRecordLike(value), 'Expected an object')
  return value
}
function id(value: unknown): string {
  assert.equal(typeof value, 'string')
  return value as string
}
async function request(
  userId: string,
  path: string,
  method = 'GET',
  body?: unknown,
  expected = 200
) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      Cookie: `better-auth.session_token=${cookies.get(userId) ?? ''}`,
      Origin: baseUrl.origin,
      'Content-Type': 'application/json',
      ...(path.startsWith('/api/v1/admin/') ? { 'x-admin-key': adminKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
    redirect: 'error',
  })
  requests.push({ method, path, status: response.status })
  const text = await response.text()
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: ${response.status} ${truncate(text, 500)}`
  )
  return text ? record(JSON.parse(text)) : {}
}
async function readVersionBytes(version: number, expected: string) {
  const path = `/api/v2/files/${fileId}/versions/${version}/content?workspaceId=${workspaceId}`
  const response = await fetch(new URL(path, baseUrl), {
    headers: { 'X-API-Key': ownerKey },
    signal: AbortSignal.timeout(120_000),
  })
  requests.push({ method: 'GET', path, status: response.status })
  assert.equal(response.status, 200, await response.clone().text())
  assert.equal(await response.text(), expected)
}

async function check(name: string, run: () => Promise<void>) {
  const start = performance.now()
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: performance.now() - start })
    logger.info(name)
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: performance.now() - start,
      error: getErrorMessage(error),
    })
    throw error
  }
}

try {
  for (const userId of [ownerId, departingId]) {
    const now = new Date()
    const token = generateShortId()
    await sql`INSERT INTO "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
      VALUES (${userId}, 'Lifecycle E2E', ${`${userId}@example.test`}, ${`${userId}@example.test`}, true, ${now}, ${now})`
    await sql`INSERT INTO user_stats (id, user_id) VALUES (${generateId()}, ${userId})`
    await sql`INSERT INTO session (id, token, user_id, expires_at, created_at, updated_at)
      VALUES (${generateId()}, ${token}, ${userId}, ${new Date(Date.now() + 86_400_000)}, ${now}, ${now})`
    cookies.set(userId, encodeURIComponent(`${token}.${await makeSignature(token, authSecret)}`))
  }
  await sql`INSERT INTO api_key (id, user_id, name, key, key_hash, type) VALUES (${generateId()}, ${ownerId}, 'Lifecycle fixture', ${ownerKey}, ${sha256Hex(ownerKey)}, 'personal')`
  await sql`INSERT INTO workspace (id, name, owner_id, billed_account_user_id)
    VALUES (${workspaceId}, 'Lifecycle HTTP fixture', ${ownerId}, ${ownerId})`
  for (const userId of [ownerId, departingId]) {
    await sql`INSERT INTO permissions (id, user_id, entity_type, entity_id, permission_type)
      VALUES (${generateId()}, ${userId}, 'workspace', ${workspaceId}, 'admin')`
  }
  await check('Create shared roots and children through HTTP', async () => {
    folderId = id(
      record(
        (
          await request(departingId, `/api/workspaces/${workspaceId}/files/folders`, 'POST', {
            name: 'Retained folder',
          })
        ).folder
      ).id
    )
    tableId = id(
      record(
        record(
          (
            await request(departingId, '/api/table', 'POST', {
              workspaceId,
              name: 'Retained_table',
              schema: { columns: [{ name: 'value', type: 'string' }] },
            })
          ).data
        ).table
      ).id
    )
    await request(departingId, `/api/table/${tableId}/rows`, 'POST', {
      workspaceId,
      data: { value: 'survives' },
    })
    kbId = id(
      record(
        (
          await request(departingId, '/api/knowledge', 'POST', {
            workspaceId,
            name: 'Retained knowledge',
          })
        ).data
      ).id
    )
    await sql`INSERT INTO document (id, knowledge_base_id, filename, file_url, file_size, mime_type, uploaded_by)
      VALUES (${documentId}, ${kbId}, 'fixture.txt', 'data:text/plain,survives', 8, 'text/plain', ${departingId})`
    fileId = id(
      record(
        (
          await request(
            departingId,
            `/api/workspaces/${workspaceId}/files`,
            'POST',
            { name: 'retained.txt', folderId, content: 'version one' },
            201
          )
        ).file
      ).id
    )
    await request(departingId, `/api/workspaces/${workspaceId}/files/${fileId}/content`, 'PUT', {
      content: 'version two',
    })
  })
  const beforeStorage =
    await sql`SELECT billed_account_user_id, storage_used_bytes FROM workspace WHERE id = ${workspaceId}`
  const versionsBefore =
    await sql`SELECT id, author_user_ids FROM workspace_file_version WHERE file_id = ${fileId} ORDER BY version`
  await check(
    'Both admin removal endpoints reject an owner transfer to a payer without existing access',
    async () => {
      await sql`UPDATE workspace SET owner_id = ${departingId} WHERE id = ${workspaceId}`
      await sql`DELETE FROM permissions WHERE entity_id = ${workspaceId} AND user_id = ${ownerId}`
      const [grant] =
        await sql`SELECT id FROM permissions WHERE entity_id = ${workspaceId} AND user_id = ${departingId}`
      for (const path of [
        `/api/v1/admin/workspaces/${workspaceId}/members?userId=${departingId}`,
        `/api/v1/admin/workspaces/${workspaceId}/members/${grant.id}`,
      ]) {
        await request(ownerId, path, 'DELETE', undefined, 400)
        assert.equal(
          (await sql`SELECT owner_id FROM workspace WHERE id = ${workspaceId}`)[0].owner_id,
          departingId
        )
        assert.equal(
          (
            await sql`SELECT id FROM permissions WHERE entity_id = ${workspaceId} AND user_id = ${ownerId}`
          ).length,
          0
        )
        assert.equal(
          (await sql`SELECT user_id FROM workspace_files WHERE id = ${fileId}`)[0].user_id,
          departingId
        )
        assert.equal((await sql`SELECT id FROM permissions WHERE id = ${grant.id}`).length, 1)
      }
      await sql`UPDATE workspace SET owner_id = ${ownerId} WHERE id = ${workspaceId}`
      await sql`INSERT INTO permissions (id, user_id, entity_type, entity_id, permission_type) VALUES (${generateId()}, ${ownerId}, 'workspace', ${workspaceId}, 'admin')`
    }
  )
  await check('Remove member atomically and deny subsequent read and create requests', async () => {
    await request(ownerId, `/api/workspaces/members/${departingId}`, 'DELETE', { workspaceId })
    assert.equal(
      (await sql`SELECT created_by FROM user_table_definitions WHERE id = ${tableId}`)[0]
        .created_by,
      ownerId
    )
    assert.equal(
      (await sql`SELECT user_id FROM knowledge_base WHERE id = ${kbId}`)[0].user_id,
      ownerId
    )
    assert.equal(
      (await sql`SELECT user_id FROM workspace_files WHERE id = ${fileId}`)[0].user_id,
      ownerId
    )
    for (const path of [
      `/api/table/${tableId}?workspaceId=${workspaceId}`,
      `/api/knowledge/${kbId}`,
      `/api/workspaces/${workspaceId}/files/${fileId}`,
    ]) {
      await request(departingId, path, 'GET', undefined, 404)
    }
    await request(
      departingId,
      '/api/table',
      'POST',
      { workspaceId, name: 'Denied', schema: { columns: [{ name: 'value', type: 'string' }] } },
      403
    )
  })
  await check('Delete departed account through authenticated HTTP', async () => {
    await request(departingId, '/api/users/me/deletion', 'POST', {
      confirmEmail: `${departingId}@example.test`,
    })
    assert.equal((await sql`SELECT id FROM "user" WHERE id = ${departingId}`).length, 0)
  })
  await check('Survivor reads existing non-null contracts and edits all shared roots', async () => {
    const table = getTableContract.response.schema.parse(
      await request(ownerId, `/api/table/${tableId}?workspaceId=${workspaceId}`)
    )
    assert.equal(table.data.table.createdBy, ownerId)
    const kb = getKnowledgeBaseContract.response.schema.parse(
      await request(ownerId, `/api/knowledge/${kbId}`)
    )
    assert.equal(kb.data.userId, ownerId)
    const file = readWorkspaceFileContract.response.schema.parse(
      await request(ownerId, `/api/workspaces/${workspaceId}/files/${fileId}`)
    )
    assert.equal(file.file.uploadedBy, ownerId)
    await readVersionBytes(1, 'version one')
    await readVersionBytes(2, 'version two')
    await request(ownerId, `/api/table/${tableId}`, 'PATCH', {
      workspaceId,
      name: 'Retained_table_edited',
    })
    const rows = await request(ownerId, `/api/table/${tableId}/rows?workspaceId=${workspaceId}`)
    const retainedRows = record(rows.data).rows
    assert(Array.isArray(retainedRows))
    assert.deepEqual(record(retainedRows[0]).data, { value: 'survives' })
    await request(ownerId, `/api/knowledge/${kbId}`, 'PUT', { name: 'Retained knowledge edited' })
    await request(ownerId, `/api/workspaces/${workspaceId}/files/folders/${folderId}`, 'PATCH', {
      name: 'Retained folder edited',
    })
    await request(ownerId, `/api/workspaces/${workspaceId}/files/${fileId}`, 'PATCH', {
      name: 'retained-edited.txt',
    })
    assert.deepEqual(
      await sql`SELECT billed_account_user_id, storage_used_bytes FROM workspace WHERE id = ${workspaceId}`,
      beforeStorage
    )
    assert.deepEqual(
      await sql`SELECT id, author_user_ids FROM workspace_file_version WHERE file_id = ${fileId} ORDER BY version`,
      versionsBefore
    )
    assert.equal((await sql`SELECT id FROM document WHERE id = ${documentId}`).length, 1)
    await request(ownerId, `/api/workspaces/${workspaceId}/files/${fileId}/content`, 'PUT', {
      content: 'survivor version',
    })
  })
} catch (error) {
  logger.error('Lifecycle E2E failed', { error })
  process.exitCode = 1
} finally {
  try {
    if (fileId) {
      const versions =
        await sql`SELECT version FROM workspace_file_version WHERE file_id = ${fileId} ORDER BY version`
      for (const version of versions.slice(0, -1)) {
        const path = `/api/v2/files/${fileId}/versions/${version.version}?workspaceId=${workspaceId}`
        const response = await fetch(new URL(path, baseUrl), {
          method: 'DELETE',
          headers: { 'X-API-Key': ownerKey },
          signal: AbortSignal.timeout(120_000),
        })
        assert.equal(response.status, 200, await response.text())
      }
      const [file] = await sql`SELECT key FROM workspace_files WHERE id = ${fileId}`
      if (file)
        await request(ownerId, '/api/files/delete', 'POST', {
          filePath: `/api/files/serve/${file.key}`,
          context: 'workspace',
        })
    }
  } catch (error) {
    checks.push({
      name: 'Stored-object cleanup',
      status: 'failed',
      durationMs: 0,
      error: getErrorMessage(error),
    })
    process.exitCode = 1
  } finally {
    try {
      await sql`DELETE FROM workspace WHERE id = ${workspaceId}`
      await sql`DELETE FROM "user" WHERE id IN (${ownerId}, ${departingId})`
    } finally {
      await sql.end()
      const untrackedHashes: Record<string, string> = {}
      for (const path of execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
        encoding: 'utf8',
      })
        .trim()
        .split('\n')
        .filter(Boolean)) {
        untrackedHashes[path] = sha256Hex(await readFile(path))
      }
      await writeFile(
        reportPath,
        JSON.stringify(
          {
            startedAt,
            finishedAt: new Date().toISOString(),
            sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
            trackedDiffSha256: sha256Hex(execFileSync('git', ['diff', 'HEAD'])),
            untrackedHashes,
            checks,
            requests,
          },
          null,
          2
        )
      )
    }
  }
}
