#!/usr/bin/env bun

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres, { type Sql } from 'postgres'
import { isSSOHardeningMigrationApplied, SSO_HARDENING_MIGRATION_TAG } from '../sso-provider-audit'

const adminUrl = requireGuardedAdminUrl()
const runId = `${Date.now()}_${process.pid}`
const databaseName = `sim_e2e_sso_rehearsal_${runId}`.toLowerCase()
const databaseUrl = new URL(adminUrl)
databaseUrl.pathname = `/${databaseName}`
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'sim-sso-migration-rehearsal-'))
const preMigrationFolder = path.join(temporaryRoot, 'migrations')
const admin = postgres(adminUrl, { max: 1, prepare: false, onnotice: () => {} })
let database: Sql | undefined

try {
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  database = postgres(databaseUrl.toString(), { max: 1, prepare: false, onnotice: () => {} })
  createPre0266MigrationFolder(preMigrationFolder)
  await migrate(drizzle(database), { migrationsFolder: preMigrationFolder })

  const [{ has_domain_verified: hasDomainVerified }] = await database<
    Array<{ has_domain_verified: boolean }>
  >`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'sso_provider'
        AND column_name = 'domain_verified'
    ) AS has_domain_verified
  `
  assert.equal(hasDomainVerified, false)
  assert.equal(await isSSOHardeningMigrationApplied(database), false)

  await seedAuditFailureMatrix(database)
  const invalidResult = runMigrate({ SSO_PROVIDER_WRITES_QUIESCED: 'true' })
  assert.equal(invalidResult.status, 1, invalidResult.output)
  for (const finding of [
    'missing-org: missing organization ownership',
    'Bad_Id: invalid provider ID',
    'google: invalid provider ID',
    "public-suffix: 'com' is not a registrable domain",
    "unknown-suffix: 'tenant.invalid' is not a registrable domain",
    'duplicate provider ID: duplicate-id',
    'organization organization-multi owns multiple providers',
    'overlapping domains: duplicate.example.com and duplicate.example.com',
    'overlapping domains: login.parent.example.net and parent.example.net',
  ]) {
    assert.match(invalidResult.output, new RegExp(escapeRegExp(finding)))
  }

  await database`DELETE FROM sso_provider`
  const emptyUnquiescedResult = runMigrate()
  assert.equal(emptyUnquiescedResult.status, 1, emptyUnquiescedResult.output)
  assert.match(emptyUnquiescedResult.output, /SSO_PROVIDER_WRITES_QUIESCED=true/)

  await seedValidLinkedProvider(database)

  const unquiescedResult = runMigrate()
  assert.equal(unquiescedResult.status, 1, unquiescedResult.output)
  assert.match(unquiescedResult.output, /SSO_PROVIDER_WRITES_QUIESCED=true/)

  const unapprovedResult = runMigrate({ SSO_PROVIDER_WRITES_QUIESCED: 'true' })
  assert.equal(unapprovedResult.status, 1, unapprovedResult.output)
  assert.match(unapprovedResult.output, /linked users\/sessions require an explicit/)

  const approvedResult = runMigrate({
    SSO_PROVIDER_WRITES_QUIESCED: 'true',
    SSO_AUDIT_APPROVED_PROVIDER_IDS: 'acme-saml',
  })
  assert.equal(approvedResult.status, 0, approvedResult.output)
  assert.equal(await isSSOHardeningMigrationApplied(database), true)

  const migratedProviders = await database<
    Array<{ provider_id: string; domain_verified: boolean }>
  >`
    SELECT provider_id, domain_verified
    FROM sso_provider
    ORDER BY provider_id
  `
  assert.deepEqual(migratedProviders, [
    { provider_id: 'acme-saml', domain_verified: false },
    { provider_id: 'private-suffix', domain_verified: false },
  ])

  const constraints = await database<Array<{ conname: string; convalidated: boolean }>>`
    SELECT conname, convalidated
    FROM pg_constraint
    WHERE conrelid = 'sso_provider'::regclass
      AND conname IN (
        'sso_provider_provider_id_format_check',
        'sso_provider_provider_id_not_reserved_check',
        'sso_provider_domain_format_check',
        'sso_provider_organization_required_check'
      )
    ORDER BY conname
  `
  assert.equal(constraints.length, 4)
  assert.ok(constraints.every(({ convalidated }) => convalidated))

  const indexes = await database<
    Array<{ indexrelid: string; indisunique: boolean; indisvalid: boolean }>
  >`
    SELECT indexrelid::regclass::text AS indexrelid, indisunique, indisvalid
    FROM pg_index
    WHERE indexrelid::regclass::text IN (
      'sso_provider_provider_id_unique',
      'sso_provider_domain_lower_unique',
      'sso_provider_organization_id_unique'
    )
    ORDER BY indexrelid::regclass::text
  `
  assert.equal(indexes.length, 3)
  assert.ok(indexes.every(({ indisunique, indisvalid }) => indisunique && indisvalid))

  const repeatResult = runMigrate()
  assert.equal(repeatResult.status, 0, repeatResult.output)
  console.log(
    'SSO migration rehearsal passed for pre-0266 failures, rollout gate, and post-0266 schema.'
  )
} finally {
  if (database) await database.end({ timeout: 5 }).catch(() => {})
  await admin.unsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()`
  )
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end({ timeout: 5 })
  rmSync(temporaryRoot, { recursive: true, force: true })
}

function createPre0266MigrationFolder(destination: string): void {
  const source = path.join(packageRoot, 'migrations')
  const journal = JSON.parse(readFileSync(path.join(source, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{
      idx: number
      tag: string
      when: number
      version: string
      breakpoints: boolean
    }>
  }
  const hardeningEntry = journal.entries.find(({ tag }) => tag === SSO_HARDENING_MIGRATION_TAG)
  if (!hardeningEntry)
    throw new Error(`Migration journal is missing ${SSO_HARDENING_MIGRATION_TAG}`)
  const entries = journal.entries.filter(({ idx }) => idx < hardeningEntry.idx)

  mkdirSync(path.join(destination, 'meta'), { recursive: true })
  writeFileSync(
    path.join(destination, 'meta', '_journal.json'),
    `${JSON.stringify({ version: '7', dialect: 'postgresql', entries }, null, 2)}\n`
  )
  for (const { tag } of entries) {
    copyFileSync(path.join(source, `${tag}.sql`), path.join(destination, `${tag}.sql`))
  }
}

async function seedAuditFailureMatrix(sql: Sql): Promise<void> {
  await seedUsersAndOrganizations(sql)
  const providers = [
    ['row-missing-org', 'missing-org', null, 'missing.example.com'],
    ['row-invalid-id', 'Bad_Id', 'organization-1', 'invalid-id.example.com'],
    ['row-reserved-id', 'google', 'organization-2', 'reserved.example.com'],
    ['row-public-suffix', 'public-suffix', 'organization-3', 'com'],
    ['row-unknown-suffix', 'unknown-suffix', 'organization-10', 'tenant.invalid'],
    ['row-duplicate-id-a', 'duplicate-id', 'organization-4', 'duplicate-a.example.com'],
    ['row-duplicate-id-b', 'duplicate-id', 'organization-5', 'duplicate-b.example.com'],
    ['row-duplicate-domain-a', 'duplicate-domain-a', 'organization-6', 'duplicate.example.com'],
    ['row-duplicate-domain-b', 'duplicate-domain-b', 'organization-7', 'duplicate.example.com'],
    ['row-parent-domain', 'parent-domain', 'organization-8', 'parent.example.net'],
    ['row-child-domain', 'child-domain', 'organization-9', 'login.parent.example.net'],
    ['row-multi-a', 'multi-a', 'organization-multi', 'multi-a.example.org'],
    ['row-multi-b', 'multi-b', 'organization-multi', 'multi-b.example.org'],
  ] as const
  for (const [id, providerId, organizationId, domain] of providers) {
    await sql`
      INSERT INTO sso_provider (
        id, issuer, domain, oidc_config, saml_config, user_id, provider_id, organization_id
      )
      VALUES (
        ${id},
        ${`https://${providerId.toLowerCase()}.example.invalid`},
        ${domain},
        NULL,
        NULL,
        'audit-user',
        ${providerId},
        ${organizationId}
      )
    `
  }
}

async function seedValidLinkedProvider(sql: Sql): Promise<void> {
  await sql`
    INSERT INTO sso_provider (
      id, issuer, domain, oidc_config, saml_config, user_id, provider_id, organization_id
    )
    VALUES (
      'row-acme',
      'https://idp.acme.invalid',
      'login.acme.com',
      NULL,
      NULL,
      'audit-user',
      'acme-saml',
      'organization-1'
    )
  `
  await sql`
    INSERT INTO sso_provider (
      id, issuer, domain, oidc_config, saml_config, user_id, provider_id, organization_id
    )
    VALUES (
      'row-private-suffix',
      'https://tenant.github.io',
      'tenant.github.io',
      NULL,
      NULL,
      'audit-user',
      'private-suffix',
      'organization-2'
    )
  `
  await sql`
    INSERT INTO account (
      id, account_id, provider_id, user_id, created_at, updated_at
    )
    VALUES ('account-acme', 'external-acme', 'acme-saml', 'audit-user', now(), now())
  `
  await sql`
    INSERT INTO session (
      id, expires_at, token, created_at, updated_at, user_id
    )
    VALUES (
      'session-acme',
      now() + interval '1 hour',
      'rehearsal-session-token',
      now(),
      now(),
      'audit-user'
    )
  `
}

async function seedUsersAndOrganizations(sql: Sql): Promise<void> {
  await sql`
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
    VALUES ('audit-user', 'Audit User', 'audit-user@example.com', true, now(), now())
    ON CONFLICT (id) DO NOTHING
  `
  const organizationIds = [
    ...Array.from({ length: 10 }, (_, index) => `organization-${index + 1}`),
    'organization-multi',
  ]
  for (const id of organizationIds) {
    await sql`
      INSERT INTO organization (id, name, slug, created_at, updated_at)
      VALUES (${id}, ${id}, ${id}, now(), now())
      ON CONFLICT (id) DO NOTHING
    `
  }
}

function runMigrate(overrides: Record<string, string> = {}): {
  status: number | null
  output: string
} {
  const result = spawnSync(
    process.execPath,
    ['--no-env-file', path.join(packageRoot, 'scripts', 'migrate.ts')],
    {
      cwd: packageRoot,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        DATABASE_URL: databaseUrl.toString(),
        MIGRATION_DATABASE_URL: databaseUrl.toString(),
        ENVIRONMENT: 'sso-rehearsal',
        ...overrides,
      },
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      timeout: 180_000,
    }
  )
  return {
    status: result.status,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  }
}

function requireGuardedAdminUrl(): string {
  const raw = process.env.E2E_PG_ADMIN_URL
  if (!raw) throw new Error('E2E_PG_ADMIN_URL is required for the SSO migration rehearsal')
  const url = new URL(raw)
  if (
    url.protocol !== 'postgresql:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/postgres'
  ) {
    throw new Error('SSO migration rehearsal requires a 127.0.0.1 PostgreSQL /postgres admin URL')
  }
  return url.toString()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
