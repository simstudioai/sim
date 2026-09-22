/** @vitest-environment node */

import { AuditAction, recordAudit } from '@sim/audit'
import type { SessionPrincipal } from '@sim/auth/principal'
import * as schema from '@sim/db/schema'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { databaseUrl, select, transaction } = vi.hoisted(() => {
  const databaseUrl = process.env.ACCESS_REQUESTS_TEST_DATABASE_URL
  if (databaseUrl) {
    const url = new URL(databaseUrl)
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.pathname !== '/sim_access_requests_test'
    )
      throw new Error('Use a disposable local sim_access_requests_test database')
  }
  return { databaseUrl, select: vi.fn(), transaction: vi.fn() }
})
vi.unmock('drizzle-orm')
vi.unmock('@sim/db/schema')
vi.mock('@sim/db', async () => ({
  ...(await import('@sim/db/schema')),
  db: { select, transaction },
  dbReplica: { select },
}))
vi.mock('@sim/audit', async (original) => ({
  ...(await original<typeof import('@sim/audit')>()),
  recordAudit: vi.fn(),
}))

import { authorizeWorkspaceOperation } from '@/lib/core/application/workspace-authorization'
import { resolveVerifiedUserAccessControlContext } from '@/lib/permission-groups/resolve.server'
import { tableOperations } from '@/lib/table/application/operations'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import {
  cancelAccessRequest,
  createAccessRequest,
  discoverAccessRequests,
  listMyAccessRequests,
  listOrganizationAccessRequests,
  updateAccessRequestSettings,
} from '@/ee/access-requests/lib/application/requests'
import {
  previewAccessRequest,
  resolveAccessRequest,
} from '@/ee/access-requests/lib/application/review'
import {
  PERMISSION_ACCESS_REQUEST_CREATED_EVENT,
  PERMISSION_ACCESS_REQUEST_DECIDED_EVENT,
} from '@/ee/access-requests/lib/notification-events'

const schemaName = `access_flow_${generateId().replaceAll('-', '')}`
const connection = databaseUrl
  ? postgres(databaseUrl, {
      max: 3,
      prepare: false,
      connection: {
        search_path: schemaName,
        application_name: schemaName,
        statement_timeout: 5000,
      },
      onnotice: () => undefined,
    })
  : undefined
const database = connection ? drizzle(connection, { schema }) : undefined
const session = (userId: string): SessionPrincipal => ({
  kind: 'session',
  userId,
  sessionId: `fixture-${userId}`,
})
const member = session('member')
const admin = session('admin')
const scope = { kind: 'workspace', workspaceId: 'primary' } as const
const target = { kind: 'feature', configKey: 'hideTablesTab' } as const
const page = { limit: 10, offset: 0 }

beforeAll(async () => {
  if (!connection) return
  await connection.unsafe(`CREATE SCHEMA "${schemaName}"`)
  await connection.unsafe(`
    CREATE TABLE "user" (
      id text PRIMARY KEY, name text NOT NULL, email text NOT NULL,
      banned boolean DEFAULT false, ban_expires timestamp, suspended_at timestamp
    );
    CREATE TABLE organization (id text PRIMARY KEY);
    CREATE TABLE member (
      id text PRIMARY KEY, organization_id text REFERENCES organization(id),
      user_id text REFERENCES "user"(id), role text NOT NULL
    );
    CREATE TABLE user_stats (
      user_id text PRIMARY KEY, billing_blocked boolean DEFAULT false, billing_blocked_reason text
    );
    CREATE TABLE subscription (
      id text PRIMARY KEY, plan text NOT NULL, reference_id text NOT NULL,
      stripe_customer_id text, stripe_subscription_id text, status text,
      period_start timestamp, period_end timestamp, cancel_at_period_end boolean,
      cancel_at timestamp, canceled_at timestamp, ended_at timestamp, seats integer,
      trial_start timestamp, trial_end timestamp, billing_interval text,
      stripe_schedule_id text, metadata json, last_closed_period_start timestamp
    );
    CREATE TABLE workspace (
      id text PRIMARY KEY, name text NOT NULL, owner_id text REFERENCES "user"(id),
      organization_id text REFERENCES organization(id), workspace_mode text,
      billed_account_user_id text, allow_personal_api_keys boolean DEFAULT true,
      archived_at timestamp
    );
    CREATE TABLE permissions (
      id text PRIMARY KEY, user_id text REFERENCES "user"(id), entity_type text,
      entity_id text, permission_type text, updated_at timestamp DEFAULT now(),
      UNIQUE(user_id, entity_type, entity_id)
    );
    CREATE TABLE permission_group (
      id text PRIMARY KEY, organization_id text REFERENCES organization(id), name text,
      description text, config jsonb NOT NULL DEFAULT '{}', created_by text,
      created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now(),
      is_default boolean DEFAULT false, membership_mode text DEFAULT 'inherit'
    );
    CREATE TABLE permission_group_workspace (
      id text PRIMARY KEY, permission_group_id text REFERENCES permission_group(id),
      workspace_id text REFERENCES workspace(id), organization_id text REFERENCES organization(id),
      created_at timestamp DEFAULT now()
    );
    CREATE TABLE permission_group_member (
      id text PRIMARY KEY, permission_group_id text REFERENCES permission_group(id),
      organization_id text REFERENCES organization(id), user_id text REFERENCES "user"(id),
      assigned_by text, assigned_at timestamp DEFAULT now()
    );
    CREATE TABLE organization_member_usage_limit (
      id text PRIMARY KEY, organization_id text, user_id text, usage_limit numeric,
      set_by text, created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now(),
      UNIQUE(organization_id, user_id)
    );
    CREATE TABLE organization_access_request_settings (
      organization_id text PRIMARY KEY REFERENCES organization(id),
      allow_requests boolean DEFAULT true, updated_at timestamp DEFAULT now(), updated_by text
    );
    CREATE TABLE permission_access_request (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organization(id),
      requester_id text NOT NULL REFERENCES "user"(id), workspace_id text,
      scope_key text NOT NULL, target_key text NOT NULL, target jsonb NOT NULL,
      target_label text NOT NULL, membership_id text NOT NULL, group_id text, group_name text,
      reason text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'pending',
      decision_reason text, decided_by text REFERENCES "user"(id), decision jsonb,
      created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(),
      decided_at timestamp,
      CHECK (status IN ('pending', 'fulfilled', 'declined', 'cancelled', 'closed'))
    );
    CREATE UNIQUE INDEX pending_request_unique ON permission_access_request
      (organization_id, requester_id, scope_key, target_key) WHERE status = 'pending';
    CREATE TABLE outbox_event (
      id text PRIMARY KEY, event_type text NOT NULL, payload json NOT NULL,
      status text DEFAULT 'pending', attempts integer DEFAULT 0, max_attempts integer DEFAULT 10,
      available_at timestamp DEFAULT now(), locked_at timestamp, last_error text,
      created_at timestamp DEFAULT now(), processed_at timestamp
    );
  `)
  select.mockImplementation((fields) => database!.select(fields))
  transaction.mockImplementation((callback) => database!.transaction(callback))
})

beforeEach(async () => {
  if (!connection) return
  vi.mocked(recordAudit).mockClear()
  setEnvFlags({ isHosted: true, isBillingEnabled: true, isAccessControlEnabled: true })
  await connection.unsafe(`
    TRUNCATE "user", organization, member, user_stats, subscription, workspace, permissions,
      permission_group, permission_group_workspace, permission_group_member,
      organization_member_usage_limit, organization_access_request_settings,
      permission_access_request, outbox_event;
    INSERT INTO "user" (id, name, email) VALUES
      ('admin', 'Admin', 'admin@example.test'), ('member', 'Member', 'member@example.test'),
      ('peer', 'Peer', 'peer@example.test'), ('external', 'External', 'external@example.test'),
      ('outsider', 'Outsider', 'outsider@example.test');
    INSERT INTO organization VALUES ('org'), ('other');
    INSERT INTO member VALUES
      ('admin-membership', 'org', 'admin', 'owner'),
      ('member-membership', 'org', 'member', 'member'),
      ('peer-membership', 'org', 'peer', 'member'),
      ('other-owner', 'other', 'outsider', 'owner'),
      ('external-membership', 'other', 'external', 'member');
    INSERT INTO user_stats (user_id) VALUES ('admin'), ('outsider');
    INSERT INTO subscription (id, plan, reference_id, status, metadata) VALUES
      ('org-subscription', 'enterprise', 'org', 'active', '{}'),
      ('other-subscription', 'enterprise', 'other', 'active', '{}');
    INSERT INTO workspace (id, name, owner_id, organization_id, workspace_mode, billed_account_user_id) VALUES
      ('primary', 'Primary', 'admin', 'org', 'organization', 'admin'),
      ('secondary', 'Secondary', 'admin', 'org', 'organization', 'admin'),
      ('foreign', 'Foreign', 'outsider', 'other', 'organization', 'outsider');
    INSERT INTO permissions (id, user_id, entity_type, entity_id, permission_type) VALUES
      ('member-primary', 'member', 'workspace', 'primary', 'write'),
      ('member-secondary', 'member', 'workspace', 'secondary', 'write'),
      ('peer-primary', 'peer', 'workspace', 'primary', 'write'),
      ('external-primary', 'external', 'workspace', 'primary', 'write');
    INSERT INTO permission_group (id, organization_id, name, config, created_by, is_default) VALUES
      ('default', 'org', 'Default', '{"hideTablesTab":true}', 'admin', true),
      ('restricted', 'org', 'Restricted', '{"hideTablesTab":true,"hideFilesTab":true}', 'admin', false);
    INSERT INTO permission_group_workspace (id, permission_group_id, workspace_id, organization_id)
      VALUES ('group-primary', 'restricted', 'primary', 'org');
  `)
})

afterAll(async () => {
  resetEnvFlagsMock()
  if (!connection) return
  try {
    await connection.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`)
  } finally {
    await connection.end()
  }
})

function create(principal = member) {
  return createAccessRequest.execute({
    principal,
    input: { scope, target, reason: 'Need tables for the project' },
  })
}

function preview(requestId: string) {
  return previewAccessRequest.execute({
    principal: admin,
    input: { organizationId: 'org', requestId },
  })
}

function apply(requestId: string, expectedFingerprint: string) {
  return resolveAccessRequest.execute({
    principal: admin,
    input: { organizationId: 'org', requestId, decision: { action: 'apply', expectedFingerprint } },
  })
}

async function authorizeTables(principal = member, workspaceId = 'primary') {
  const workspace = await getWorkspaceWithOwner(workspaceId, { executor: database! })
  if (!workspace) throw new Error('Missing fixture workspace')
  return authorizeWorkspaceOperation(
    principal,
    tableOperations.list,
    {
      workspaceId: workspace.id,
      workspaceOrganizationId: workspace.organizationId,
      allowPersonalApiKeys: workspace.allowPersonalApiKeys,
    },
    { executor: database! }
  )
}

async function storedState() {
  const [group] = await database!
    .select({ config: schema.permissionGroup.config })
    .from(schema.permissionGroup)
    .where(eq(schema.permissionGroup.id, 'restricted'))
  return {
    config: group.config,
    requests: await connection!`
      SELECT id, status, decision, decision_reason, decided_by, decided_at, updated_at
      FROM permission_access_request ORDER BY id
    `,
    memberLimits: await connection!`
      SELECT organization_id, user_id, usage_limit, set_by, updated_at
      FROM organization_member_usage_limit ORDER BY organization_id, user_id
    `,
    events: await connection!`SELECT event_type FROM outbox_event ORDER BY event_type`,
    audit: vi.mocked(recordAudit).mock.calls.map(([entry]) => ({
      action: entry.action,
      actorId: entry.actorId,
      workspaceId: entry.workspaceId,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      metadata: structuredClone(entry.metadata),
    })),
  }
}

describe.skipIf(!databaseUrl)('access request member-to-admin flow on PostgreSQL', () => {
  it('refuses workspace API keys before any protected read or transaction', async () => {
    const readsBefore = select.mock.calls.length
    const transactionsBefore = transaction.mock.calls.length
    await expect(
      createAccessRequest.execute({
        principal: { kind: 'workspace_api_key', workspaceId: 'primary', keyId: 'fixture-key' },
        input: { scope, target },
      })
    ).rejects.toMatchObject({ detailCode: 'WORKSPACE_KEY_OPERATION_NOT_PERMITTED' })
    expect(select.mock.calls).toHaveLength(readsBefore)
    expect(transaction.mock.calls).toHaveLength(transactionsBefore)
    expect((await storedState()).requests).toEqual([])
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled()
  })

  it('discovers, deduplicates, previews and applies access through the governing group', async () => {
    await expect(authorizeTables()).rejects.toMatchObject({
      detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    })
    const discovery = await discoverAccessRequests.execute({
      principal: member,
      input: {
        ...scope,
        targetKind: 'feature',
        targetKey: 'feature:hideTablesTab',
        state: 'requestable',
        limit: 1,
      },
    })
    expect(discovery.entries).toMatchObject([
      { target, state: 'requestable', pendingRequestId: null },
    ])
    const created = await create()
    expect(created).toMatchObject({
      changed: true,
      request: { status: 'pending', requester: { id: 'member' } },
    })
    expect(await create()).toMatchObject({ changed: false, request: { id: created.request.id } })
    const inbox = await listOrganizationAccessRequests.execute({
      principal: admin,
      input: { organizationId: 'org', status: 'pending', ...page },
    })
    expect(inbox.requests.map(({ id }) => id)).toEqual([created.request.id])
    const prepared = await preview(created.request.id)
    expect(prepared).toMatchObject({
      canApply: true,
      resolutionKind: 'permission',
      group: { id: 'restricted' },
      impact: { memberCount: 4, workspaceCount: 1, workspaceNames: ['Primary'], truncated: false },
    })
    expect(await apply(created.request.id, prepared.fingerprint)).toMatchObject({
      changed: true,
      request: { status: 'fulfilled' },
    })
    await expect(authorizeTables()).resolves.toBeUndefined()
    await expect(authorizeTables(session('peer'))).resolves.toBeUndefined()
    await expect(authorizeTables(session('external'))).resolves.toBeUndefined()
    await expect(authorizeTables(member, 'secondary')).rejects.toMatchObject({
      detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    })
    const effective = await resolveVerifiedUserAccessControlContext(
      'member',
      'primary',
      'org',
      database!
    )
    expect(effective).toMatchObject({
      entitled: true,
      permissionGroup: { id: 'restricted' },
      config: { hideTablesTab: false, hideFilesTab: true },
    })
    const history = await listMyAccessRequests.execute({
      principal: member,
      input: { scope, ...page },
    })
    expect(history.requests).toMatchObject([{ id: created.request.id, status: 'fulfilled' }])
    const persisted = await storedState()
    expect(persisted.events).toEqual([
      { event_type: PERMISSION_ACCESS_REQUEST_CREATED_EVENT },
      { event_type: PERMISSION_ACCESS_REQUEST_DECIDED_EVENT },
    ])
    expect(vi.mocked(recordAudit).mock.calls.map(([entry]) => entry.action)).toEqual([
      AuditAction.PERMISSION_ACCESS_REQUEST_CREATED,
      AuditAction.PERMISSION_ACCESS_REQUEST_FULFILLED,
      AuditAction.PERMISSION_GROUP_UPDATED,
    ])
    expect(await apply(created.request.id, prepared.fingerprint)).toMatchObject({ changed: false })
    expect(await storedState()).toEqual(persisted)
  })

  it('fulfills an organization member credit-cap request without changing another member', async () => {
    await connection!`
      INSERT INTO organization_member_usage_limit (id, organization_id, user_id, usage_limit, set_by)
      VALUES ('member-cap', 'org', 'member', 10, 'admin'), ('peer-cap', 'org', 'peer', 7, 'admin')
    `
    const organizationScope = { kind: 'organization', organizationId: 'org' } as const
    const { request } = await createAccessRequest.execute({
      principal: member,
      input: {
        scope: organizationScope,
        target: { kind: 'usage_limit', id: 'member' },
        reason: 'Need more credits for the project',
      },
    })
    expect(request).toMatchObject({ organizationId: 'org', workspaceId: null, status: 'pending' })
    const prepared = await preview(request.id)
    expect(prepared).toMatchObject({
      canApply: true,
      resolutionKind: 'usage_limit',
      group: null,
      currentLimitCredits: 2000,
      newLimitCredits: null,
    })
    const before = await storedState()
    await expect(apply(request.id, prepared.fingerprint)).rejects.toMatchObject({
      code: 'validation',
    })
    await expect(
      resolveAccessRequest.execute({
        principal: admin,
        input: {
          organizationId: 'org',
          requestId: request.id,
          decision: {
            action: 'apply',
            expectedFingerprint: 'stale-preview',
            newLimitCredits: 3001,
          },
        },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(await storedState()).toEqual(before)
    expect(
      await resolveAccessRequest.execute({
        principal: admin,
        input: {
          organizationId: 'org',
          requestId: request.id,
          decision: {
            action: 'apply',
            expectedFingerprint: prepared.fingerprint,
            newLimitCredits: 3001,
          },
        },
      })
    ).toMatchObject({ changed: true, request: { id: request.id, status: 'fulfilled' } })
    const after = await storedState()
    expect(after.memberLimits).toMatchObject([
      { organization_id: 'org', user_id: 'member', usage_limit: '15.005', set_by: 'admin' },
      { organization_id: 'org', user_id: 'peer', usage_limit: '7', set_by: 'admin' },
    ])
    expect(after.memberLimits[1]).toEqual(before.memberLimits[1])
    expect(after.config).toEqual(before.config)
    expect(after.audit.map(({ action }) => action)).toEqual([
      AuditAction.PERMISSION_ACCESS_REQUEST_CREATED,
      AuditAction.PERMISSION_ACCESS_REQUEST_FULFILLED,
      AuditAction.ORG_MEMBER_USAGE_LIMIT_CHANGED,
    ])
    const history = await listMyAccessRequests.execute({
      principal: member,
      input: { scope: organizationScope, ...page },
    })
    expect(history.requests).toMatchObject([
      {
        id: request.id,
        target: request.target,
        reason: request.reason,
        createdAt: request.createdAt,
        status: 'fulfilled',
        workspaceId: null,
      },
    ])
    expect(await preview(request.id)).toMatchObject({
      canApply: false,
      resolutionKind: 'usage_limit',
      currentLimitCredits: 2000,
      newLimitCredits: 3001,
      fingerprint: prepared.fingerprint,
    })
  })

  it.each(['decline', 'cancel'] as const)(
    'keeps the policy denied after %s and makes the decision idempotent',
    async (action) => {
      const { request } = await create()
      const decide = () =>
        action === 'cancel'
          ? cancelAccessRequest.execute({
              principal: member,
              input: { scope, requestId: request.id },
            })
          : resolveAccessRequest.execute({
              principal: admin,
              input: {
                organizationId: 'org',
                requestId: request.id,
                decision: { action: 'decline', reason: 'Not needed for this role' },
              },
            })
      expect(await decide()).toMatchObject({
        changed: true,
        request: { status: action === 'cancel' ? 'cancelled' : 'declined' },
      })
      const persisted = await storedState()
      expect(persisted.config).toMatchObject({ hideTablesTab: true, hideFilesTab: true })
      expect(persisted.events).toHaveLength(2)
      expect(await decide()).toMatchObject({ changed: false })
      expect(await storedState()).toEqual(persisted)
      await expect(authorizeTables()).rejects.toMatchObject({
        detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
      })
    }
  )

  it.each(['policy', 'audience'] as const)(
    'rejects a stale preview after %s changes without partial writes',
    async (change) => {
      const { request } = await create()
      const prepared = await preview(request.id)
      if (change === 'policy') {
        await connection!`UPDATE permission_group SET config = config || '{"disableTableExport":true}'::jsonb WHERE id = 'restricted'`
      } else {
        await connection!`DELETE FROM permissions WHERE id = 'peer-primary'`
      }
      const persisted = await storedState()
      await expect(apply(request.id, prepared.fingerprint)).rejects.toMatchObject({
        code: 'conflict',
      })
      expect(await storedState()).toEqual(persisted)
      const refreshed = await preview(request.id)
      expect(refreshed.fingerprint).not.toBe(prepared.fingerprint)
      expect(await apply(request.id, refreshed.fingerprint)).toMatchObject({
        request: { status: 'fulfilled' },
      })
    }
  )

  it('enforces admin, requester and organization scope against real memberships', async () => {
    const { request } = await create()
    const persisted = await storedState()
    await expect(
      previewAccessRequest.execute({
        principal: member,
        input: { organizationId: 'org', requestId: request.id },
      })
    ).rejects.toMatchObject({ detailCode: 'ORGANIZATION_ADMIN_REQUIRED' })
    await expect(
      resolveAccessRequest.execute({
        principal: member,
        input: {
          organizationId: 'org',
          requestId: request.id,
          decision: { action: 'decline', reason: 'No' },
        },
      })
    ).rejects.toMatchObject({ detailCode: 'ORGANIZATION_ADMIN_REQUIRED' })
    await expect(
      cancelAccessRequest.execute({
        principal: session('peer'),
        input: { scope, requestId: request.id },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      cancelAccessRequest.execute({
        principal: member,
        input: { scope: { kind: 'workspace', workspaceId: 'secondary' }, requestId: request.id },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      previewAccessRequest.execute({
        principal: session('outsider'),
        input: { organizationId: 'other', requestId: request.id },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(create(session('outsider'))).rejects.toMatchObject({ code: 'not_found' })
    expect(await storedState()).toEqual(persisted)
  })

  it('allows workspace collaborators to request access without granting organization authority', async () => {
    const { request } = await create(session('external'))
    expect((await preview(request.id)).canApply).toBe(true)
    await expect(
      listMyAccessRequests.execute({
        principal: session('external'),
        input: { scope: { kind: 'organization', organizationId: 'org' }, ...page },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    await connection!`DELETE FROM permissions WHERE id = 'external-primary'`
    const prepared = await preview(request.id)
    expect(prepared.canApply).toBe(false)
    await expect(apply(request.id, prepared.fingerprint)).rejects.toMatchObject({
      code: 'conflict',
    })
    expect((await storedState()).requests).toMatchObject([{ id: request.id, status: 'pending' }])
  })

  it('preserves history and cancellation while requests are paused', async () => {
    const { request } = await create()
    await updateAccessRequestSettings.execute({
      principal: admin,
      input: { organizationId: 'org', allowRequests: false },
    })
    const discovery = await discoverAccessRequests.execute({
      principal: member,
      input: { ...scope, targetKind: 'feature', limit: 1 },
    })
    expect(discovery).toMatchObject({ enabled: false, entries: [] })
    await expect(create()).rejects.toMatchObject({ detailCode: 'ACCESS_REQUESTS_DISABLED' })
    expect(
      (await listMyAccessRequests.execute({ principal: member, input: { scope, ...page } }))
        .requests
    ).toMatchObject([{ id: request.id, status: 'pending' }])
    expect((await preview(request.id)).canApply).toBe(false)
    expect(
      await cancelAccessRequest.execute({
        principal: member,
        input: { scope, requestId: request.id },
      })
    ).toMatchObject({ changed: true, request: { status: 'cancelled' } })
  })
})
