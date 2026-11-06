import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { settingsMembers } from '@/platform/fixtures/settings/members'
import { settingsWorkspaces } from '@/platform/fixtures/settings/organization'
import type { SettingsFixtureState } from '@/platform/fixtures/settings/state'
import {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  type PermissionGroup,
} from '@/platform/lib/data/permission-policy'

const CREATED_AT = '2026-10-13T11:24:00.000Z'

interface GroupExample {
  group: PermissionGroup
  people: string[]
}

function group(id: string, name: string, state: SettingsFixtureState): PermissionGroup {
  const { profile } = state.general
  return {
    id,
    name,
    description: null,
    config: { ...DEFAULT_PERMISSION_GROUP_CONFIG },
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    createdBy: profile.id,
    creatorName: profile.name,
    creatorEmail: profile.email,
    memberCount: 0,
    isDefault: false,
    membershipMode: 'inherit',
    workspaces: [],
  }
}

function groupExamples(state: SettingsFixtureState) {
  const existing = state.records.get('permissionGroups') as Map<string, GroupExample> | undefined
  if (existing) return existing
  const examples = new Map<string, GroupExample>()
  if (state.scenario !== 'empty') {
    const standard = group('everyone', 'Organization default', state)
    examples.set(standard.id, { group: { ...standard, isDefault: true }, people: [] })
    const operations = group('operations-team', 'Customer operations', state)
    examples.set(operations.id, {
      group: {
        ...operations,
        description: 'Access for the customer operations team.',
        workspaces: [settingsWorkspaces[0]],
        memberCount: 1,
        membershipMode: 'explicit',
      },
      people: ['jo'],
    })
    if (state.scenario === 'stress') {
      for (let i = 0; i < 24; i++) {
        const team = group(
          `project-team-${i + 1}`,
          `Customer operations and research team ${i + 1}`,
          state
        )
        examples.set(team.id, {
          group: { ...team, workspaces: [settingsWorkspaces[i % settingsWorkspaces.length]] },
          people: [],
        })
      }
    }
  }
  state.records.set('permissionGroups', examples)
  return examples
}

function writeResult(group: PermissionGroup, state: SettingsFixtureState) {
  return {
    permissionGroup: {
      ...group,
      organizationId: state.organizationId,
      workspaceIds: group.workspaces.map(({ id }) => id),
    },
  }
}

export async function permissionGroupsFixture(
  request: Request,
  path: string,
  state: SettingsFixtureState
): Promise<unknown> {
  const prefix = `/api/organizations/${state.organizationId}/permission-groups`
  if (path === '/api/settings/allowed-providers') return { blacklistedProviders: [] }
  if (path === '/api/projects')
    return {
      projects:
        state.scenario === 'empty'
          ? []
          : [
              {
                id: 'project-operations',
                name: 'Operations',
                organizationId: state.organizationId,
                ownerId: state.general.profile.id,
                archivedAt: null,
                createdAt: CREATED_AT,
                updatedAt: CREATED_AT,
                environments: [],
                capabilities: { administer: true, issues: true },
              },
            ],
      nextCursor: null,
    }
  if (path.startsWith('/api/providers/') && path.endsWith('/models')) {
    const provider = path.split('/')[3]
    const { default: catalog } = await import(
      '@/platform/fixtures/settings/permission-catalog.generated.json'
    )
    return {
      models:
        catalog.providers.find((entry) => entry.id === provider)?.models.map((model) => model.id) ??
        [],
    }
  }
  if (path === `${prefix}/editor-catalog`)
    return (await import('@/platform/fixtures/settings/permission-catalog.generated.json')).default
  if (path !== prefix && !path.startsWith(`${prefix}/`)) return
  const groups = groupExamples(state)
  const [id, resource, action] = path.slice(prefix.length + 1).split('/')
  if (!id && request.method === 'GET')
    return { permissionGroups: [...groups.values()].map((row) => row.group) }
  if (id && request.method === 'DELETE' && !resource) {
    groups.delete(id)
    return { success: true }
  }
  const example = id ? groups.get(id) : undefined
  if (resource === 'members' && example) {
    if (request.method === 'GET')
      return {
        members: settingsMembers(state)
          .filter((person) => example.people.includes(person.id))
          .map((person) => ({
            id: person.id,
            userId: person.id,
            assignedAt: CREATED_AT,
            userName: person.name,
            userEmail: person.email,
            userImage: null,
          })),
      }
    if (request.method === 'DELETE') {
      const member = new URL(request.url).searchParams.get('memberId')
      example.people = example.people.filter((id) => id !== member)
      example.group.memberCount = example.people.length
      return { success: true }
    }
    if (action === 'bulk' && request.method === 'POST') {
      const body = toRecord(await request.json())
      const selected = Array.isArray(body.userIds)
        ? body.userIds.filter((id): id is string => typeof id === 'string')
        : []
      const newPeople = selected.filter((id) => !example.people.includes(id))
      example.people.push(...newPeople)
      example.group.memberCount = example.people.length
      example.group.membershipMode = 'explicit'
      return { added: newPeople.length, skipped: selected.length - newPeople.length }
    }
    return
  }
  if ((!id && request.method === 'POST') || (example && request.method === 'PUT')) {
    const fields = toRecord(await request.json())
    const previous = example?.group ?? group(generateId(), '', state)
    const updated = { ...previous }
    if (typeof fields.name === 'string') updated.name = fields.name
    if (typeof fields.description === 'string' || fields.description === null)
      updated.description = fields.description
    if (fields.config) updated.config = { ...previous.config, ...toRecord(fields.config) }
    if (Array.isArray(fields.workspaceIds)) {
      const ids: unknown[] = fields.workspaceIds
      updated.workspaces = settingsWorkspaces.filter((workspace) => ids.includes(workspace.id))
    }
    if (typeof fields.isDefault === 'boolean') updated.isDefault = fields.isDefault
    if (updated.isDefault) {
      updated.workspaces = []
      for (const row of groups.values()) row.group.isDefault = false
    }
    groups.set(updated.id, { group: updated, people: example?.people ?? [] })
    return writeResult(updated, state)
  }
  if (example && !resource && request.method === 'GET')
    return { permissionGroup: { ...example.group, organizationId: state.organizationId } }
}
