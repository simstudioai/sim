import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { settingsWorkspaces } from '@/platform/fixtures/settings/organization'
import type { SettingsFixtureState } from '@/platform/fixtures/settings/state'
import type { ScimConnectionView, ScimGroupMappingView } from '@/platform/lib/data/scim'

const INITIAL_DATE = '2026-10-13T11:24:00.000Z'

function initialConnection(baseUrl: string): ScimConnectionView {
  return {
    id: generateId(),
    status: 'active',
    baseUrl,
    settings: {},
    lastRequestAt: null,
    reconciledAt: null,
    createdAt: INITIAL_DATE,
    credentials: [],
    userCount: 0,
    groupCount: 0,
  }
}

function createFixture(full: boolean, origin: string) {
  const connection = initialConnection(`${origin}/api/scim/v2`)
  if (full) {
    connection.userCount = 4
    connection.groupCount = 1
    connection.lastRequestAt = INITIAL_DATE
    connection.credentials.push({
      id: 'initial-token',
      tokenPrefix: 'sim_scim_a132',
      scopes: ['users:read', 'users:write', 'groups:read', 'groups:write'],
      createdAt: INITIAL_DATE,
      lastUsedAt: INITIAL_DATE,
      expiresAt: null,
    })
  }
  const groups = full
    ? [
        {
          id: 'engineering',
          displayName: 'Engineering',
          memberCount: 4,
          mappings: [
            {
              id: 'engineering-workspace',
              groupId: 'engineering',
              groupDisplayName: 'Engineering',
              targetKind: 'workspace',
              permissionGroupId: null,
              workspaceId: settingsWorkspaces[0].id,
              permissionType: 'write',
              role: null,
              source: 'manual',
            } satisfies ScimGroupMappingView,
          ] as ScimGroupMappingView[],
        },
      ]
    : []
  return {
    connection: full ? connection : null,
    groups,
    entries: full
      ? [
          {
            id: 'group-sync',
            method: 'GET',
            path: '/Groups',
            status: 200,
            scimType: null,
            detail: null,
            userAgent: 'Identity provider',
            durationMs: 12,
            createdAt: INITIAL_DATE,
          },
        ]
      : [],
  }
}

const sessions = new WeakMap<SettingsFixtureState, ReturnType<typeof createFixture>>()

export async function provisioningFixture(
  request: Request,
  key: string,
  state: SettingsFixtureState
): Promise<unknown> {
  const origin = new URL(request.url).origin
  const fixture = sessions.get(state) ?? createFixture(state.scenario !== 'empty', origin)
  sessions.set(state, fixture)
  if (key === 'scim') {
    if (request.method === 'PUT') {
      const input = toRecord(await request.json())
      const connection = fixture.connection ?? initialConnection(`${origin}/api/scim/v2`)
      if (input.status === 'active' || input.status === 'disabled') connection.status = input.status
      connection.settings = { ...connection.settings, ...toRecord(input.settings) }
      fixture.connection = connection
    }
    return { connection: fixture.connection }
  }
  if (key === 'scim/activity') return { entries: fixture.entries }
  if (key === 'scim/mappings') {
    if (request.method === 'GET') return { groups: fixture.groups }
    const input = toRecord(await request.json())
    const group = fixture.groups.find((item) => item.id === input.groupId)
    if (!group) return
    const mapping: ScimGroupMappingView = {
      id: generateId(),
      groupId: group.id,
      groupDisplayName: group.displayName,
      targetKind:
        input.targetKind === 'permission_group'
          ? 'permission_group'
          : input.targetKind === 'org_role'
            ? 'org_role'
            : 'workspace',
      permissionGroupId:
        typeof input.permissionGroupId === 'string' ? input.permissionGroupId : null,
      workspaceId: typeof input.workspaceId === 'string' ? input.workspaceId : null,
      permissionType:
        input.permissionType === 'admin' ||
        input.permissionType === 'read' ||
        input.permissionType === 'write'
          ? input.permissionType
          : null,
      role: typeof input.role === 'string' ? input.role : null,
      source: 'manual',
    }
    group.mappings.push(mapping)
    return { mapping, reconciledUsers: 0 }
  }
  if (key.startsWith('scim/mappings/') && request.method === 'DELETE') {
    for (const group of fixture.groups)
      group.mappings = group.mappings.filter((item) => !key.endsWith(`/${item.id}`))
    return { success: true, reconciledUsers: 0 }
  }
  const connection = fixture.connection
  if (!connection) return
  const now = new Date()
  if (key === 'scim/credentials' && request.method === 'POST') {
    const expires = toRecord(await request.json()).expiresInDays
    const secret = `fixture-token-${generateId()}`
    const credential: ScimConnectionView['credentials'][number] = {
      id: generateId(),
      tokenPrefix: secret.slice(0, 17),
      scopes: ['users:read', 'users:write', 'groups:read', 'groups:write'],
      expiresAt:
        typeof expires === 'number'
          ? new Date(now.getTime() + expires * 86400000).toISOString()
          : null,
      lastUsedAt: null,
      createdAt: now.toISOString(),
    }
    connection.credentials.push(credential)
    return { secret, credential }
  }
  if (key.startsWith('scim/credentials/') && request.method === 'DELETE') {
    connection.credentials = connection.credentials.filter((item) => !key.endsWith(`/${item.id}`))
    return { success: true }
  }
  if (key === 'scim/reconcile') {
    connection.reconciledAt = now.toISOString()
    return { reconciledUsers: connection.userCount, grantsAdded: 0, grantsRemoved: 0 }
  }
}
