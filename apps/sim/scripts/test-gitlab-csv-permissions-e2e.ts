import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import postgres from 'postgres'

/** Exercises the public CI endpoint against a running Sim and preconfigured CSV source. */
const base = new URL(process.env.GITLAB_CSV_E2E_BASE_URL ?? '')
assert.equal(base.protocol, 'http:')
assert(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
const sql = postgres(assertDisposableTestDatabaseUrl(process.env.DATABASE_URL ?? '').href)
const reportPath = process.env.GITLAB_CSV_E2E_REPORT_PATH
assert(reportPath, 'Set GITLAB_CSV_E2E_REPORT_PATH')
const checks: string[] = []
const org = generateId()
const otherOrg = generateId()
const admin = generateId()
const member = generateId()
const otherAdmin = generateId()
const workspace = generateId()
const kb = generateId()
const source = generateId()
const key = () => `sk-sim-fixture-${generateId()}`
const adminKey = key()
const memberKey = key()
const otherAdminKey = key()
const workspaceKey = key()
const project = 'engineering/pilot'
const initialEmail = `${admin}@fixture.test`
const nextEmail = `${member}@fixture.test`
const pat = `fixture-preserved-${generateId()}`
const file = (filename: string, content: string) => ({ filename, content })
const labels = { filename: 'initial.csv', rowCount: 1, uploadedAt: new Date().toISOString() }
const csv = (expectedRevision: number, id = 2) => ({
  expectedRevision,
  permissions: {
    provider: 'gitlab',
    userMapping: file(
      'users.csv',
      `user_id,email\n1,${initialEmail}\n2,${nextEmail.toUpperCase()}\n`
    ),
    projectPermissions: file(
      'projects.csv',
      `project_path,user_id\n${project},${id}\nelsewhere/team,1\n`
    ),
  },
})
const path = (organizationId = org) =>
  `/api/v2/organizations/${organizationId}/search/sources/${source}/permissions`

async function request(token: string, body?: unknown, organizationId = org) {
  return fetch(new URL(path(organizationId), base), {
    method: body === undefined ? 'GET' : 'PUT',
    headers: { 'X-API-Key': token, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(180_000),
    redirect: 'error',
  })
}

async function checkRevision(response: Response, revision: number) {
  assert.equal(response.status, 200, `Expected revision ${revision}, HTTP ${response.status}`)
  assert.deepEqual(await response.json(), { data: { revision } })
}

async function grants() {
  const rows = await sql`select subject_token from knowledge_connector_permission_grant
    where connector_id = ${source} and group_key = 'project' order by subject_token`
  return rows.map((row) => row.subject_token)
}

let failure: string | undefined
try {
  await sql.begin(async (tx) => {
    for (const id of [admin, member, otherAdmin]) {
      await tx`insert into "user" (id, name, email, email_verified, created_at, updated_at)
        values (${id}, 'GitLab CSV fixture', ${`${id}@fixture.test`}, true, now(), now())`
    }
    for (const id of [org, otherOrg]) {
      await tx`insert into organization (id, name, slug) values (${id}, 'GitLab CSV fixture', ${id})`
      await tx`insert into member (id, organization_id, user_id, role)
        values (${generateId()}, ${id}, ${id === org ? admin : otherAdmin}, 'admin')`
    }
    await tx`insert into member (id, organization_id, user_id, role)
      values (${generateId()}, ${org}, ${member}, 'member')`
    await tx`insert into project (id, name, owner_id) values (${workspace}, 'GitLab CSV fixture', ${admin})`
    await tx`insert into workspace (id, project_id, name, owner_id, billed_account_user_id)
      values (${workspace}, ${workspace}, 'GitLab CSV fixture', ${admin}, ${admin})`
    for (const [id, token, scope] of [
      [admin, adminKey, null],
      [member, memberKey, null],
      [otherAdmin, otherAdminKey, null],
      [admin, workspaceKey, workspace],
    ] as const) {
      await tx`insert into api_key (id, user_id, workspace_id, name, key, key_hash, type) values
        (${generateId()}, ${id}, ${scope}, 'GitLab CSV fixture', ${token}, ${sha256Hex(token)}, ${scope ? 'workspace' : 'personal'})`
    }
    await tx`insert into knowledge_base (id, name, user_id, organization_id, is_search_index)
      values (${kb}, 'GitLab CSV fixture', ${admin}, ${org}, true)`
    await tx`insert into knowledge_connector
      (id, knowledge_base_id, connector_type, access_mode, encrypted_api_key, source_config)
      values (${source}, ${kb}, 'gitlab', 'admin', ${pat}, ${tx.json({ host: 'gitlab.fixture.invalid', project })})`
    await tx`insert into knowledge_connector_permission_snapshot (connector_id, revision, metadata, payload)
      values (${source}, 1, ${tx.json({
        host: 'gitlab.fixture.invalid',
        projectId: 10,
        projectPath: project,
        mode: 'csv',
        userMapping: labels,
        projectPermissions: labels,
      })},
        ${tx.json({ userMappingRows: [['1', initialEmail]], projectPermissionRows: [[project, '1']] })})`
    await tx`insert into knowledge_connector_permission_grant (connector_id, group_key, subject_token)
      values (${source}, 'project', ${`u:${initialEmail}`})`
  })
  await checkRevision(await request(adminKey), 1)
  checks.push(
    'An organization admin can read the revision without exposing the CSV contents or PAT'
  )

  for (const token of [memberKey, workspaceKey]) {
    for (const body of [undefined, csv(1)]) assert.equal((await request(token, body)).status, 403)
  }
  assert.equal((await request(otherAdminKey, csv(1), otherOrg)).status, 404)
  assert.equal(
    (
      await request(adminKey, {
        expectedRevision: 1,
        permissions: { provider: 'gitlab', userMapping: csv(1).permissions.userMapping },
      })
    ).status,
    400
  )
  assert.equal((await request(adminKey, { ...csv(1), apiKey: 'unexpected' })).status, 400)
  assert.equal(
    (
      await request(adminKey, {
        ...csv(1),
        permissions: {
          ...csv(1).permissions,
          userMapping: file('users.csv', 'x'.repeat(10 * 1024 * 1024)),
        },
      })
    ).status,
    413
  )
  assert.equal(
    (
      await request(adminKey, {
        ...csv(1),
        permissions: { ...csv(1).permissions, userMapping: file('users.csv', '1,invalid') },
      })
    ).status,
    400
  )
  assert.equal(
    (
      await request(adminKey, {
        ...csv(1),
        permissions: { ...csv(1).permissions, provider: 'unknown' },
      })
    ).status,
    400
  )
  assert.deepEqual(await grants(), [`u:${initialEmail}`])
  await checkRevision(await request(adminKey), 1)
  checks.push(
    'Unauthorized, cross-organization and invalid replacements preserve the existing grant and revision'
  )

  await sql`update knowledge_connector set connector_type = 'github' where id = ${source}`
  assert.equal((await request(adminKey)).status, 404)
  assert.equal((await request(adminKey, csv(1))).status, 404)
  await sql`update knowledge_connector set connector_type = 'gitlab' where id = ${source}`
  const [original] =
    await sql`select metadata from knowledge_connector_permission_snapshot where connector_id = ${source}`
  assert(original)
  await sql`update knowledge_connector_permission_snapshot
    set metadata = metadata || '{"mode":"administrator","userMapping":null,"projectPermissions":null}'::jsonb
    where connector_id = ${source}`
  assert.equal((await request(adminKey)).status, 404)
  assert.equal((await request(adminKey, csv(1))).status, 404)
  await sql`update knowledge_connector_permission_snapshot set metadata = ${sql.json(original.metadata)} where connector_id = ${source}`
  assert.deepEqual(await grants(), [`u:${initialEmail}`])
  checks.push('Only an existing GitLab CSV source accepts replacements')

  const race = await Promise.all([request(adminKey, csv(1)), request(adminKey, csv(1))])
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409])
  const winner = race.find((r) => r.ok)
  assert(winner)
  await checkRevision(winner, 2)
  assert.deepEqual(await grants(), [`u:${nextEmail}`])
  assert.equal((await request(adminKey, csv(1, 1))).status, 409)
  assert.deepEqual(await grants(), [`u:${nextEmail}`])
  checks.push(
    'Concurrent updates grant only the mapped member for this project and stale retries cannot restore removed access'
  )

  await sql`update knowledge_connector set status = 'paused' where id = ${source}`
  await checkRevision(await request(adminKey, csv(2, 1)), 3)
  await checkRevision(await request(adminKey), 3)
  assert.deepEqual(await grants(), [`u:${initialEmail}`])
  const [connector] =
    await sql`select status, encrypted_api_key, source_config, next_sync_at, access_rewrite_pending
    from knowledge_connector where id = ${source}`
  assert.deepEqual(connector?.source_config, { host: 'gitlab.fixture.invalid', project })
  assert.equal(connector?.status, 'paused')
  assert.equal(connector?.encrypted_api_key, pat)
  assert.equal(connector?.next_sync_at, null)
  assert.equal(connector?.access_rewrite_pending, false)
  checks.push(
    'A paused source can revoke a prior grant while preserving its status, configuration, PAT and schedule'
  )
} catch (error) {
  failure = getErrorMessage(error)
} finally {
  try {
    await sql.begin(async (tx) => {
      await tx`delete from workspace where id = ${workspace}`
      await tx`delete from project where id = ${workspace}`
      await tx`delete from organization where id in (${org}, ${otherOrg})`
      await tx`delete from "user" where id in (${admin}, ${member}, ${otherAdmin})`
    })
  } catch (error) {
    failure ??= getErrorMessage(error)
  } finally {
    await sql.end()
    await writeFile(
      reportPath,
      JSON.stringify({ status: failure ? 'failed' : 'passed', checks, failure }, null, 2)
    )
  }
}

if (failure) throw new Error(failure)
