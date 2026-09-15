import type { Principal } from '@sim/auth/principal'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import {
  CAPABILITY_RULES,
  type StaticPermissionGroupCapability,
} from '@/lib/permission-groups/capabilities'
import { capabilityDeniedBy } from '@/lib/permission-groups/capability-assertions'
import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'
import { listAccessibleWorkspaceRowsForUser } from '@/lib/workspaces/utils'

export const organizationWorkspaceOperations = {
  list: defineOrganizationOperation({
    id: 'organization.workspaces.list',
    minimumRole: 'member',
    capability: 'copilot.use',
    principalKinds: ['session', 'organization_delegated'],
    delegationAudience: 'sim:workspaces',
    delegatedServices: ['copilot'],
  }),
} as const

/** Current membership and capability discovery; returned inventory never grants operation access. */
export const listOrganizationWorkspaces = {
  operation: organizationWorkspaceOperations.list,
  async execute({
    principal,
    input,
  }: {
    principal: Principal
    input: {
      organizationId: string
      workspaceId?: string
      query?: string
      limit: number
      cursor?: string
    }
  }) {
    const context = await authorizeOrganizationOperation(
      principal,
      organizationWorkspaceOperations.list,
      input
    )
    const rows = await listAccessibleWorkspaceRowsForUser(
      context.userId,
      'active',
      context.organizationId
    )
    const query = input.query?.toLocaleLowerCase()
    const eligible = rows
      .filter(
        ({ workspace }) =>
          workspace.organizationId === context.organizationId &&
          (!input.workspaceId || workspace.id === input.workspaceId) &&
          (!query || workspace.name.toLocaleLowerCase().includes(query)) &&
          (!input.cursor || workspace.id > input.cursor)
      )
      .sort((a, b) => a.workspace.id.localeCompare(b.workspace.id))
    const page = eligible.slice(0, input.limit)
    const workspaces = await mapWithConcurrency(page, 8, async ({ workspace, permissionType }) => {
      const config = await resolvePermissionGroupConfig(
        context.userId,
        workspace.id,
        context.organizationId
      )
      const capabilities: Record<string, boolean> = {}
      for (const [id, rule] of Object.entries(CAPABILITY_RULES)) {
        if (rule.kind !== 'static') continue
        capabilities[id] = !capabilityDeniedBy(id as StaticPermissionGroupCapability, config)
      }
      capabilities['personal_api_key.use'] &&= workspace.allowPersonalApiKeys
      return {
        id: workspace.id,
        name: workspace.name,
        role: permissionType,
        ...(input.workspaceId
          ? { capabilityDetail: 'full' as const, capabilities }
          : {
              capabilityDetail: 'restrictions' as const,
              copilotAllowed: capabilities['copilot.use'] === true,
              deniedCapabilities: Object.keys(capabilities).filter(
                (id) => capabilities[id] === false
              ),
            }),
      }
    })
    return {
      workspaces,
      nextCursor: eligible.length > input.limit ? page.at(-1)!.workspace.id : null,
    }
  },
}
