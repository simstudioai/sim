/** @vitest-environment node */

import * as schema from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { databaseUrl } = vi.hoisted(() => {
  const databaseUrl = process.env.BILLING_USAGE_TEST_DATABASE_URL
  if (databaseUrl && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)) {
    throw new Error('Workspace detachment integration tests require a disposable local database')
  }
  return { databaseUrl }
})
vi.unmock('drizzle-orm')
vi.unmock('@sim/db/schema')

import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/membership'
import { acquireInvitationMutationLocks } from '@/lib/invitations/locks'
import { detachOrganizationWorkspacesTx } from '@/lib/workspaces/organization-workspaces'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'

const schemaName = `workspace_detach_${generateId().replaceAll('-', '')}`
const connection = databaseUrl
  ? postgres(databaseUrl, {
      max: 3,
      prepare: false,
      connection: { search_path: schemaName, application_name: schemaName },
      onnotice: () => undefined,
    })
  : undefined
const database = connection ? drizzle(connection, { schema }) : undefined

beforeAll(async () => {
  if (!connection) return
  await connection.unsafe(`CREATE SCHEMA "${schemaName}"`)
  await connection.unsafe(`
    CREATE TABLE member (id text PRIMARY KEY, organization_id text, user_id text, role text);
    CREATE TABLE organization (id text PRIMARY KEY, storage_used_bytes bigint NOT NULL);
    CREATE TABLE invitation (
      id text PRIMARY KEY, organization_id text REFERENCES organization(id) ON DELETE CASCADE
    );
    CREATE TABLE user_stats (user_id text PRIMARY KEY, storage_used_bytes bigint NOT NULL);
    CREATE TABLE workspace (
      id text PRIMARY KEY, name text, owner_id text, organization_id text, workspace_mode text,
      billed_account_user_id text, allow_personal_api_keys boolean DEFAULT true,
      archived_at timestamp, organization_assigned_at timestamp, updated_at timestamp,
      storage_used_bytes bigint NOT NULL
    );
    CREATE TABLE permissions (
      id text PRIMARY KEY, user_id text, entity_type text, entity_id text, permission_type text,
      created_at timestamp, updated_at timestamp, UNIQUE(user_id, entity_type, entity_id)
    );
    CREATE TABLE workspace_files (workspace_id text, context text, size_bytes bigint);
    CREATE TABLE knowledge_base (id text PRIMARY KEY, workspace_id text);
    CREATE TABLE document (
      knowledge_base_id text, file_size bigint, connector_id text, deleted_at timestamp
    );
    CREATE TABLE knowledge_connector (
      knowledge_base_id text, detached_at timestamp, detach_reserved_bytes bigint NOT NULL DEFAULT 0
    );
  `)
})

beforeEach(async () => {
  if (!connection) return
  await connection.unsafe(`
    TRUNCATE member, organization, invitation, user_stats, workspace, permissions,
      workspace_files, knowledge_base, document, knowledge_connector;
    INSERT INTO member VALUES ('owner-membership', 'org', 'org-owner', 'owner');
    INSERT INTO organization VALUES ('org', 40);
    INSERT INTO invitation VALUES ('invitation', 'org');
    INSERT INTO user_stats VALUES ('org-owner', 5);
    INSERT INTO workspace (
      id, name, owner_id, organization_id, workspace_mode, billed_account_user_id,
      organization_assigned_at, storage_used_bytes
    ) VALUES ('workspace', 'Workspace', 'workspace-owner', 'org', 'organization', 'org-owner', now(), 40);
    INSERT INTO workspace_files VALUES ('workspace', 'workspace', 40);
  `)
})

afterAll(async () => {
  if (!connection) return
  await connection.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`)
  await connection.end()
})

describe.skipIf(!databaseUrl)('organization workspace detachment lock order', () => {
  it.each(['standalone', 'organization-delete'] as const)(
    'lets acceptance finish before %s without inverting invitation, workspace, or organization locks',
    async (mode) => {
      const acceptanceReady = Promise.withResolvers<void>()
      const continueAcceptance = Promise.withResolvers<void>()
      const acceptance = database!
        .transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL statement_timeout = '4s'`)
          await acquireInvitationMutationLocks(tx, {
            invitationIds: ['invitation'],
            workspaceIds: [],
          })
          await tx
            .select({ id: schema.invitation.id })
            .from(schema.invitation)
            .where(eq(schema.invitation.id, 'invitation'))
            .for('update')
          if (mode === 'organization-delete') {
            acceptanceReady.resolve()
            await continueAcceptance.promise
          }
          await acquireInvitationMutationLocks(tx, {
            invitationIds: [],
            workspaceIds: ['workspace'],
          })
          const current = await getWorkspaceWithOwner('workspace', {
            executor: tx,
            forUpdate: true,
          })
          expect(current?.organizationId).toBe('org')
          if (mode === 'standalone') {
            acceptanceReady.resolve()
            await continueAcceptance.promise
          }
          await acquireOrganizationMutationLock(tx, 'org')
        })
        .catch((error: unknown) => {
          acceptanceReady.reject(error)
          throw error
        })
      const acceptanceOutcome = Promise.allSettled([acceptance])
      await acceptanceReady.promise

      const detachPid = Promise.withResolvers<number>()
      const detachment = database!
        .transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL statement_timeout = '4s'`)
          const [backend] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
          detachPid.resolve(backend.pid)
          const result = await detachOrganizationWorkspacesTx(tx, 'org')
          if (mode === 'organization-delete') {
            await tx.delete(schema.organization).where(eq(schema.organization.id, 'org'))
          }
          return result
        })
        .catch((error: unknown) => {
          detachPid.reject(error)
          throw error
        })
      const detachOutcome = Promise.allSettled([detachment])

      try {
        const pid = await detachPid.promise
        await vi.waitFor(
          async () => {
            const [waiting] = await connection!`
            SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}
          `
            expect(waiting.wait_event_type).toBe('Lock')
          },
          { timeout: 2000 }
        )
      } finally {
        continueAcceptance.resolve()
        await Promise.all([acceptanceOutcome, detachOutcome])
      }

      await expect(acceptance).resolves.toBeUndefined()
      await expect(detachment).resolves.toMatchObject({
        detachedWorkspaceIds: ['workspace'],
        billedAccountUserId: 'org-owner',
        auditEntries: [{ resourceId: 'workspace' }],
      })
      const [detached] = await connection!`
      SELECT organization_id, workspace_mode, billed_account_user_id,
        organization_assigned_at, storage_used_bytes::int
      FROM workspace WHERE id = 'workspace'
    `
      expect(detached).toEqual({
        organization_id: null,
        workspace_mode: 'grandfathered_shared',
        billed_account_user_id: 'org-owner',
        organization_assigned_at: null,
        storage_used_bytes: 40,
      })
      expect(
        await connection!`SELECT storage_used_bytes::int FROM organization WHERE id = 'org'`
      ).toEqual(mode === 'organization-delete' ? [] : [{ storage_used_bytes: 0 }])
      expect(await connection!`SELECT id FROM invitation`).toEqual(
        mode === 'organization-delete' ? [] : [{ id: 'invitation' }]
      )
      expect(
        await connection!`SELECT storage_used_bytes::int FROM user_stats WHERE user_id = 'org-owner'`
      ).toEqual([{ storage_used_bytes: 45 }])
      expect(
        await connection!`
      SELECT user_id, entity_type, entity_id, permission_type FROM permissions
    `
      ).toEqual([
        {
          user_id: 'org-owner',
          entity_type: 'workspace',
          entity_id: 'workspace',
          permission_type: 'admin',
        },
      ])
    }
  )
})
