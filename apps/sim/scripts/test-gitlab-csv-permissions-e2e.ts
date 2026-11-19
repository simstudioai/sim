import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import postgres from 'postgres'

/** Exercises the public CI endpoint against a running Sim and preconfigured CSV source. */
const base = new URL(process.env.GITLAB_CSV_E2E_BASE_URL ?? '')
assert.equal(base.protocol, 'http:')
assert(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
const sql = postgres(assertDisposableTestDatabaseUrl(process.env.DATABASE_URL ?? '').href)
const reportPath = process.env.GITLAB_CSV_E2E_REPORT_PATH ?? ''
assert(reportPath, 'Set GITLAB_CSV_E2E_REPORT_PATH')
const checks: string[] = []
const logger = createLogger('GitLabCsvPermissionsE2E')
const scale = {
  enabled: process.env.GITLAB_CSV_E2E_LARGE_IMPORT === '1',
  phase: 'not_started',
  uploadedParts: 0,
  uploadedRows: 0,
  maxPartBytes: 0,
  clientPeakRssBytes: 0,
  uploadMilliseconds: 0,
  completeMilliseconds: 0,
  persistedIdentities: 0,
  persistedGrants: 0,
  activeGrants: 0,
  readerPlan: null as unknown,
}
const org = generateId()
const otherOrg = generateId()
const admin = generateId()
const member = generateId()
const otherAdmin = generateId()
const billingOwner = generateId()
const otherBillingOwner = generateId()
const workspace = generateId()
const kb = generateId()
const source = generateId()
const key = () => `sk-sim-fixture-${generateId()}`
const adminKey = key()
const secondAdminKey = key()
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
async function writeReport(status: 'running' | 'failed' | 'passed') {
  await writeFile(reportPath, JSON.stringify({ status, checks, scale, failure }, null, 2))
}

try {
  await writeReport('running')
  await sql.begin(async (tx) => {
    for (const id of [admin, member, otherAdmin, billingOwner, otherBillingOwner]) {
      await tx`insert into "user" (id, name, email, email_verified, created_at, updated_at)
        values (${id}, 'GitLab CSV fixture', ${`${id}@fixture.test`}, true, now(), now())`
    }
    for (const id of [org, otherOrg]) {
      await tx`insert into organization (id, name, slug) values (${id}, 'GitLab CSV fixture', ${id})`
      await tx`insert into member (id, organization_id, user_id, role)
        values (${generateId()}, ${id}, ${id === org ? admin : otherAdmin}, 'admin')`
      await tx`insert into member (id, organization_id, user_id, role)
        values (${generateId()}, ${id}, ${id === org ? billingOwner : otherBillingOwner}, 'owner')`
    }
    await tx`insert into member (id, organization_id, user_id, role)
      values (${generateId()}, ${org}, ${member}, 'member')`
    await tx`insert into project (id, name, owner_id) values (${workspace}, 'GitLab CSV fixture', ${admin})`
    await tx`insert into workspace (id, project_id, name, owner_id, billed_account_user_id)
      values (${workspace}, ${workspace}, 'GitLab CSV fixture', ${admin}, ${admin})`
    for (const [id, token, scope] of [
      [admin, adminKey, null],
      [admin, secondAdminKey, null],
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
  const sourcePath = path().replace(/\/permissions$/, '')
  const sourceRequest = (token: string, method = 'GET', body?: unknown, suffix = '') =>
    fetch(new URL(`${sourcePath}${suffix}`, base), {
      method,
      headers: { 'X-API-Key': token, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
      signal: AbortSignal.timeout(180_000),
    })
  const sourceResponse = await sourceRequest(adminKey)
  assert.equal(sourceResponse.status, 200)
  const sourceText = await sourceResponse.text()
  const sourceData = JSON.parse(sourceText).data
  assert.equal(sourceData.id, source)
  assert.equal(sourceData.permissionConfig.revision, 1)
  assert(!sourceText.includes(pat))
  assert(!sourceText.includes(initialEmail))
  for (const token of [memberKey, workspaceKey]) {
    assert.equal((await sourceRequest(token)).status, 403)
    assert.equal((await sourceRequest(token, 'PATCH', { status: 'paused' })).status, 403)
    assert.equal((await sourceRequest(token, 'DELETE')).status, 403)
  }
  const list = await fetch(new URL(sourcePath.slice(0, sourcePath.lastIndexOf('/')), base), {
    headers: { 'X-API-Key': adminKey },
    redirect: 'error',
  })
  assert.equal(list.status, 200)
  assert.deepEqual(
    (await list.json()).data.map((row: { id: string }) => row.id),
    [source]
  )
  for (const status of ['paused', 'active']) {
    const response = await sourceRequest(adminKey, 'PATCH', { status })
    assert.equal(response.status, 200, await response.clone().text())
    assert.equal((await response.json()).data.id, source)
    await checkRevision(await request(adminKey), 1)
  }
  checks.push(
    'Source discovery and pause/resume preserve IDs and CSV revisions; administrative reads exclude secrets and deny member and workspace keys'
  )
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

  const importRequest = (suffix: string, method: string, body?: unknown, token = adminKey) =>
    fetch(new URL(`${path()}/imports${suffix}`, base), {
      method,
      headers: { 'X-API-Key': token, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(180_000),
      redirect: 'error',
    })
  const manifest = {
    provider: 'gitlab',
    expectedRevision: 3,
    userMapping: { filename: 'users.csv', parts: 1, rowCount: 3 },
    projectPermissions: { filename: 'projects.csv', parts: 2, rowCount: 2 },
  }
  for (const field of ['userMapping', 'projectPermissions'] as const) {
    for (const counts of [
      { parts: 2, rowCount: 1 },
      { parts: 1, rowCount: 5001 },
    ]) {
      assert.equal(
        (
          await importRequest('', 'POST', {
            ...manifest,
            [field]: { ...manifest[field], ...counts },
          })
        ).status,
        400,
        `${field}: an impossible part/row count must not reserve an import`
      )
    }
  }
  assert.equal(
    (
      await importRequest('', 'POST', {
        ...manifest,
        userMapping: { ...manifest.userMapping, parts: 2048, rowCount: 2048 },
        projectPermissions: { ...manifest.projectPermissions, parts: 2049, rowCount: 2049 },
      })
    ).status,
    400
  )
  await sql`update knowledge_connector_permission_snapshot set revision = 2147483647
    where connector_id = ${source}`
  for (const expectedRevision of [2_147_483_647, 2_147_483_648]) {
    assert.equal(
      (await importRequest('', 'POST', { ...manifest, expectedRevision })).status,
      400,
      'A revision without room for the completed snapshot must not reserve an import'
    )
  }
  await checkRevision(await request(adminKey), 2_147_483_647)
  await sql`update knowledge_connector_permission_snapshot set revision = 3
    where connector_id = ${source}`
  const [reserved] = await sql`select count(*)::integer as count
    from knowledge_connector_permission_import where connector_id = ${source}`
  assert.equal(reserved?.count, 0)
  await checkRevision(await request(adminKey), 3)
  checks.push(
    'Impossible row/part manifests, exhausted revisions and combined part overflow do not reserve import capacity or change permissions'
  )
  assert.equal((await importRequest('', 'POST', manifest, memberKey)).status, 403)
  const started = await importRequest('', 'POST', manifest)
  assert.equal(started.status, 201)
  const { data: pending } = await started.json()
  assert.equal((await importRequest(`/${pending.id}/complete`, 'POST', {})).status, 400)
  assert.deepEqual(await grants(), [`u:${initialEmail}`])
  const identityPart = {
    field: 'userMapping',
    content: `user_id,email\n1,${initialEmail}\n2,${nextEmail}\n1,${initialEmail}\n`,
  }
  assert.equal(
    (await importRequest(`/${pending.id}/parts/0`, 'PUT', identityPart, secondAdminKey)).status,
    404
  )
  assert.equal(
    (await importRequest(`/${pending.id}/complete`, 'POST', {}, secondAdminKey)).status,
    404
  )
  assert.equal((await importRequest(`/${pending.id}/parts/0`, 'PUT', identityPart)).status, 200)
  assert.equal((await importRequest(`/${pending.id}/parts/0`, 'PUT', identityPart)).status, 200)
  const oversizedUtf8 = `${project}/${'é'.repeat(300)},2\n`.repeat(2000)
  assert(oversizedUtf8.length < 1024 * 1024 && Buffer.byteLength(oversizedUtf8) > 1024 * 1024)
  const byteRejected = await importRequest(`/${pending.id}/parts/1`, 'PUT', {
    field: 'projectPermissions',
    content: oversizedUtf8,
  })
  assert.equal(byteRejected.status, 400)
  assert.equal(
    (await byteRejected.json()).error.message,
    'The permission import exceeds its byte limit.'
  )
  const [byteReceipt] =
    await sql`select user_rows, project_rows, jsonb_array_length(part_digests) as parts
    from knowledge_connector_permission_import where id = ${pending.id}`
  assert.deepEqual(byteReceipt, { user_rows: 3, project_rows: 0, parts: 1 })
  checks.push(
    'Multibyte CSV parts respect the UTF-8 byte ceiling without advancing the upload receipt'
  )
  assert.equal(
    (
      await importRequest(`/${pending.id}/parts/0`, 'PUT', {
        ...identityPart,
        content: `1,changed@fixture.test\n`,
      })
    ).status,
    409
  )
  assert.equal(
    (
      await importRequest(`/${pending.id}/parts/2`, 'PUT', {
        field: 'projectPermissions',
        content: `${project},999\n`,
      })
    ).status,
    409
  )
  assert.equal(
    (
      await importRequest(`/${pending.id}/parts/1`, 'PUT', {
        field: 'projectPermissions',
        content: `${project},2\n`,
      })
    ).status,
    200
  )
  assert.deepEqual(await grants(), [`u:${initialEmail}`])
  assert.equal(
    (
      await importRequest(`/${pending.id}/parts/2`, 'PUT', {
        field: 'projectPermissions',
        content: `${project},999\n`,
      })
    ).status,
    200
  )
  await checkRevision(await importRequest(`/${pending.id}/complete`, 'POST', {}), 4)
  await checkRevision(await importRequest(`/${pending.id}/complete`, 'POST', {}), 4)
  assert.deepEqual(await grants(), [])
  const importedGrants = await sql`select distinct identity.subject_token
    from knowledge_connector_permission_import_grant grant_row
    join knowledge_connector_permission_import_identity identity
      on identity.import_id = grant_row.import_id and identity.user_id = grant_row.user_id
    join knowledge_connector_permission_snapshot snapshot
      on snapshot.payload ->> 'importId' = grant_row.import_id
    where snapshot.connector_id = ${source} and grant_row.group_key = 'project'`
  assert.deepEqual(
    importedGrants.map((row) => row.subject_token),
    [`u:${nextEmail}`]
  )
  const [smallSummary] = await sql`select
    (metadata -> 'userMapping' ->> 'rowCount')::integer as users,
    (metadata -> 'projectPermissions' ->> 'rowCount')::integer as projects
    from knowledge_connector_permission_snapshot where connector_id = ${source}`
  assert.equal(smallSummary?.users, 2)
  assert.equal(smallSummary?.projects, 2)
  assert.equal(
    (
      await importRequest(`/${pending.id}/parts/3`, 'PUT', {
        field: 'projectPermissions',
        content: `${project},1\n`,
      })
    ).status,
    409
  )
  await checkRevision(await request(adminKey, csv(4, 1)), 5)
  assert.deepEqual(await grants(), [`u:${initialEmail}`])
  checks.push(
    'Staged imports are bound to the initiating key, count physical rows separately, preserve old access until complete, retry safely, deny unknown identities and remain compatible with inline replacement'
  )

  const smallManifest = {
    provider: 'gitlab',
    expectedRevision: 5,
    userMapping: { filename: 'users.csv', parts: 1, rowCount: 1 },
    projectPermissions: { filename: 'projects.csv', parts: 1, rowCount: 1 },
  }
  const staleResponse = await importRequest('', 'POST', smallManifest)
  assert.equal(staleResponse.status, 201)
  const { data: stale } = await staleResponse.json()
  assert.equal(
    (
      await importRequest(`/${stale.id}/parts/0`, 'PUT', {
        field: 'userMapping',
        content: `1,${nextEmail}\n`,
      })
    ).status,
    200
  )
  assert.equal(
    (
      await importRequest(`/${stale.id}/parts/1`, 'PUT', {
        field: 'projectPermissions',
        content: `${project},1\n`,
      })
    ).status,
    200
  )
  await checkRevision(await request(adminKey, csv(5, 1)), 6)
  assert.equal((await importRequest(`/${stale.id}/complete`, 'POST', {})).status, 409)
  assert.deepEqual(await grants(), [`u:${initialEmail}`])
  await checkRevision(await request(adminKey), 6)
  checks.push('A completed upload cannot overwrite permissions changed after its pinned revision')

  const expiredResponse = await importRequest('', 'POST', { ...smallManifest, expectedRevision: 6 })
  assert.equal(expiredResponse.status, 201)
  const { data: expired } = await expiredResponse.json()
  assert.equal(
    (
      await importRequest(`/${expired.id}/parts/0`, 'PUT', {
        field: 'userMapping',
        content: `1,${nextEmail}\n`,
      })
    ).status,
    200
  )
  await sql`update knowledge_connector_permission_import set expires_at = now() - interval '1 second'
    where id = ${expired.id} and connector_id = ${source}`
  assert.equal(
    (
      await importRequest(`/${expired.id}/parts/1`, 'PUT', {
        field: 'projectPermissions',
        content: `${project},1\n`,
      })
    ).status,
    409
  )
  assert.equal((await importRequest(`/${expired.id}/complete`, 'POST', {})).status, 409)
  assert.deepEqual(await grants(), [`u:${initialEmail}`])
  await checkRevision(await request(adminKey), 6)
  checks.push(
    'Expired incomplete imports reject further writes and cannot replace active permissions'
  )
  await writeReport('running')

  await sql`delete from knowledge_connector_permission_import import_row
    where import_row.connector_id = ${source}
      and not exists (select 1 from knowledge_connector_permission_snapshot snapshot
        where snapshot.connector_id = ${source} and snapshot.payload ->> 'importId' = import_row.id)`

  if (scale.enabled) {
    const identities = 500_000
    const rowsPerPart = 5000
    const projects = [
      project,
      ...Array.from({ length: 5 }, (_, index) => `outside/project-${index}`),
    ]
    const largeManifest = {
      provider: 'gitlab',
      expectedRevision: 6,
      userMapping: { filename: 'users.csv', parts: identities / rowsPerPart, rowCount: identities },
      projectPermissions: {
        filename: 'projects.csv',
        parts: (identities * projects.length) / rowsPerPart,
        rowCount: identities * projects.length,
      },
    }
    const response = await importRequest('', 'POST', largeManifest)
    assert.equal(response.status, 201)
    const { data: largeImport } = await response.json()
    const startedAt = performance.now()
    scale.phase = 'uploading'
    await writeReport('running')

    async function uploadRows(
      field: 'userMapping' | 'projectPermissions',
      row: (id: number) => string
    ) {
      const header = field === 'userMapping' ? 'user_id,email\n' : 'project_path,user_id\n'
      for (let offset = 0; offset < identities; offset += rowsPerPart) {
        const content =
          header +
          Array.from({ length: rowsPerPart }, (_, index) => row(offset + index + 1)).join('')
        const bytes = Buffer.byteLength(content)
        assert(bytes <= 1024 * 1024)
        const response = await importRequest(
          `/${largeImport.id}/parts/${scale.uploadedParts}`,
          'PUT',
          { field, content }
        )
        assert.equal(
          response.status,
          200,
          `Large import part ${scale.uploadedParts} returned HTTP ${response.status}`
        )
        assert.deepEqual(await response.json(), { data: { nextPart: scale.uploadedParts + 1 } })
        scale.uploadedParts++
        scale.uploadedRows += rowsPerPart
        scale.maxPartBytes = Math.max(scale.maxPartBytes, bytes)
        scale.clientPeakRssBytes = Math.max(scale.clientPeakRssBytes, process.memoryUsage().rss)
        if (scale.uploadedParts % 50 === 0) {
          await checkRevision(await request(adminKey), 6)
          assert.deepEqual(await grants(), [`u:${initialEmail}`])
          scale.uploadMilliseconds = Math.round(performance.now() - startedAt)
          await writeReport('running')
          logger.info('Permission import progress', {
            parts: scale.uploadedParts,
            rows: scale.uploadedRows,
            elapsedMilliseconds: scale.uploadMilliseconds,
          })
        }
      }
    }

    await uploadRows(
      'userMapping',
      (id) => `${id},${id === 1 ? nextEmail : `large-user-${id}@fixture.test`}\n`
    )
    for (const projectPath of projects) {
      await uploadRows('projectPermissions', (id) => `${projectPath},${id}\n`)
    }
    assert.equal(scale.uploadedParts, 700)
    await checkRevision(await request(adminKey), 6)
    assert.deepEqual(await grants(), [`u:${initialEmail}`])
    const [beforeComplete] = await sql`select payload from knowledge_connector_permission_snapshot
      where connector_id = ${source}`
    assert.notEqual(beforeComplete?.payload.importId, largeImport.id)
    scale.phase = 'completing'
    scale.uploadMilliseconds = Math.round(performance.now() - startedAt)
    await writeReport('running')
    const completingAt = performance.now()
    await checkRevision(await importRequest(`/${largeImport.id}/complete`, 'POST', {}), 7)
    scale.completeMilliseconds = Math.round(performance.now() - completingAt)
    await checkRevision(await importRequest(`/${largeImport.id}/complete`, 'POST', {}), 7)
    await checkRevision(await request(adminKey), 7)
    assert.deepEqual(await grants(), [])
    const [counts] = await sql`select
      (select count(*)::integer from knowledge_connector_permission_import_identity where import_id = ${largeImport.id}) as identities,
      count(*)::integer as grants,
      count(*) filter (where group_key = 'project')::integer as active,
      count(*) filter (where group_key is null)::integer as excluded
      from knowledge_connector_permission_import_grant where import_id = ${largeImport.id}`
    assert.equal(counts?.identities, 500_000)
    assert.equal(counts?.grants, 3_000_000)
    assert.equal(counts?.active, 500_000)
    assert.equal(counts?.excluded, 2_500_000)
    scale.persistedIdentities = counts.identities
    scale.persistedGrants = counts.grants
    scale.activeGrants = counts.active
    const [snapshot] =
      await sql`select revision, metadata, payload from knowledge_connector_permission_snapshot
      where connector_id = ${source}`
    assert.equal(snapshot?.revision, 7)
    assert.deepEqual(snapshot?.payload, { importId: largeImport.id })
    assert.equal(snapshot?.metadata.userMapping.rowCount, 500_000)
    assert.equal(snapshot?.metadata.projectPermissions.rowCount, 3_000_000)
    const { db } = await import('@sim/db')
    try {
      const { hasConnectorPermissionGrant, readConnectorPermissionGrants } = await import(
        '@/lib/knowledge/connectors/permission-store'
      )
      assert.equal(await hasConnectorPermissionGrant(source, 'project', `u:${nextEmail}`), true)
      assert.equal(await hasConnectorPermissionGrant(source, 'project', `u:${initialEmail}`), false)
      assert.equal(
        await hasConnectorPermissionGrant(source, 'project', 'u:unknown@fixture.test'),
        false
      )
      assert.deepEqual(
        await readConnectorPermissionGrants(
          source,
          7,
          ['project', ...projects.slice(1)],
          `u:${nextEmail}`
        ),
        new Set(['project'])
      )
      assert.deepEqual(
        await readConnectorPermissionGrants(source, 6, ['project'], `u:${nextEmail}`),
        new Set()
      )
      await checkRevision(await request(adminKey, csv(7, 1)), 8)
      assert.equal(await hasConnectorPermissionGrant(source, 'project', `u:${initialEmail}`), true)
      assert.equal(await hasConnectorPermissionGrant(source, 'project', `u:${nextEmail}`), false)
    } finally {
      await db.$client.end()
    }
    scale.readerPlan = await sql`explain (analyze, buffers, format json)
      select grant_row.group_key
      from knowledge_connector_permission_import import_row
      join knowledge_connector_permission_import_identity identity on identity.import_id = import_row.id
      join knowledge_connector_permission_import_grant grant_row
        on grant_row.import_id = identity.import_id and grant_row.user_id = identity.user_id
      where import_row.id = ${largeImport.id} and import_row.connector_id = ${source}
        and identity.subject_token = ${`u:${nextEmail}`}
        and grant_row.group_key = 'project' limit 1`
    checks.push(
      'A real HTTP import persists 500,000 identities and 3,000,000 unique grants without publishing partial access; production readers enforce scope and revocation, and inline replacement retires the generation'
    )
    scale.phase = 'verified'
    await writeReport('running')
  }
  const current = await request(adminKey)
  assert.equal(current.status, 200)
  const revision = (await current.json()).data.revision
  const directory = await mkdtemp(join(tmpdir(), 'sim-permission-cli-e2e-'))
  try {
    await writeFile(join(directory, 'users.csv'), `user_id,email\n1,${initialEmail}\n`, {
      mode: 0o600,
    })
    await writeFile(join(directory, 'projects.csv'), `project_path,user_id\n${project},1\n`, {
      mode: 0o600,
    })
    const cli = await promisify(execFile)(
      'bun',
      [
        '--no-env-file',
        fileURLToPath(new URL('../../../packages/sim-cli/src/index.ts', import.meta.url)),
        '--endpoint',
        base.origin,
        '--output',
        'json',
        'organizations',
        'search',
        'sources',
        'permissions',
        'upload',
        source,
        '--organization',
        org,
        '--provider',
        'gitlab',
        '--expected-revision',
        String(revision),
        '--user-mapping',
        'users.csv',
        '--project-permissions',
        'projects.csv',
        '--yes',
      ],
      {
        cwd: directory,
        env: { ...process.env, SIM_CONFIG_DIR: directory, SIM_API_KEY: adminKey, NO_COLOR: '1' },
        timeout: 180_000,
        maxBuffer: 1024 * 1024,
      }
    )
    assert.equal(JSON.parse(cli.stdout).revision, revision + 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  await checkRevision(await request(adminKey), revision + 1)
  checks.push(
    'The production CLI uploads both CSVs through real HTTP and commits exactly one new permission revision'
  )
  const removed = await sourceRequest(adminKey, 'DELETE')
  assert.equal(removed.status, 200, await removed.clone().text())
  assert.deepEqual(await removed.json(), { data: { id: source, deleted: true } })
  assert.equal((await request(adminKey)).status, 404)
  checks.push('Source deletion removes permission access through the public API')
} catch (error) {
  failure = getErrorMessage(error)
} finally {
  try {
    await sql.begin(async (tx) => {
      await tx`delete from workspace where id = ${workspace}`
      await tx`delete from project where id = ${workspace}`
      await tx`delete from organization where id in (${org}, ${otherOrg})`
      await tx`delete from "user" where id in (${admin}, ${member}, ${otherAdmin}, ${billingOwner}, ${otherBillingOwner})`
    })
  } catch (error) {
    failure ??= getErrorMessage(error)
  } finally {
    await sql.end()
    await writeReport(failure ? 'failed' : 'passed')
  }
}

if (failure) throw new Error(failure)
