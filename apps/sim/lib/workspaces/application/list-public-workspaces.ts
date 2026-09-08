import type { ListSortOrder } from '@/lib/api/list-query'
import { SIM_CLI_CLIENT_ID } from '@/lib/auth/oauth-provider'
import {
  authorizeWorkspaceOperation,
  type OperationUseCase,
  requireAllowedWorkspacePrincipal,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { isWorkspaceCapabilityWithheld } from '@/lib/permission-groups/capability-assertions'
import { workspaceOperations } from '@/lib/workspaces/application/operations'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'
import {
  getPublicWorkspaceDetail,
  getPublicWorkspaceDetails,
  type PublicWorkspaceDetail,
} from '@/lib/workspaces/public-queries'
import { listAccessibleWorkspaceRowsForUser } from '@/lib/workspaces/utils'

export interface ListPublicWorkspacesInput {
  sortBy: 'name' | 'createdAt' | 'updatedAt'
  sortOrder: ListSortOrder
  limit: number
  offset: number
}

export interface ListPublicWorkspacesResult {
  workspaces: PublicWorkspaceDetail[]
  hasMore: boolean
  offset: number
  limit: number
}

type WorkspaceRow = Awaited<
  ReturnType<typeof listAccessibleWorkspaceRowsForUser>
>[number]['workspace']

const WORKSPACE_CAPABILITY_CONCURRENCY = 8

function compareWorkspaceRows(
  left: WorkspaceRow,
  right: WorkspaceRow,
  sortBy: ListPublicWorkspacesInput['sortBy'],
  sortOrder: ListSortOrder
): number {
  const direction = sortOrder === 'asc' ? 1 : -1
  const primary =
    sortBy === 'name'
      ? left.name.localeCompare(right.name)
      : left[sortBy].getTime() - right[sortBy].getTime()
  return primary === 0 ? left.id.localeCompare(right.id) * direction : primary * direction
}

async function requirePublicWorkspaceDetail(workspaceId: string): Promise<PublicWorkspaceDetail> {
  const workspace = await getPublicWorkspaceDetail(workspaceId)
  if (!workspace) throw new Error(`Accessible workspace ${workspaceId} disappeared during listing`)
  return workspace
}

export const listPublicWorkspaces: OperationUseCase<
  typeof workspaceOperations.listPublic,
  ListPublicWorkspacesInput,
  ListPublicWorkspacesResult
> = {
  operation: workspaceOperations.listPublic,
  async execute({ principal, input }) {
    requireAllowedWorkspacePrincipal(principal, workspaceOperations.listPublic)

    if (principal.kind === 'workspace_api_key') {
      const context = await loadActiveWorkspaceApplicationContext(principal.workspaceId)
      if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
      await authorizeWorkspaceOperation(principal, workspaceOperations.listPublic, context)
      const workspace = await requirePublicWorkspaceDetail(context.workspaceId)
      return {
        workspaces: input.offset === 0 ? [workspace] : [],
        hasMore: false,
        offset: input.offset,
        limit: input.limit,
      }
    }

    const accessible = await listAccessibleWorkspaceRowsForUser(principal.userId, 'active')
    const candidates = accessible.filter(({ workspace }) => workspace.allowPersonalApiKeys)
    const governed = await mapWithConcurrency(
      candidates,
      WORKSPACE_CAPABILITY_CONCURRENCY,
      async ({ workspace }) => {
        const personalCredentialsWithheld = await isWorkspaceCapabilityWithheld(
          principal.userId,
          workspace.id,
          'personal_api_key.use',
          workspace.organizationId
        )
        if (personalCredentialsWithheld) return null

        if (principal.kind !== 'oauth_access_token' || principal.clientId !== SIM_CLI_CLIENT_ID) {
          return workspace
        }

        const cliWithheld = await isWorkspaceCapabilityWithheld(
          principal.userId,
          workspace.id,
          'cli.use',
          workspace.organizationId
        )
        return cliWithheld ? null : workspace
      }
    )
    const sorted = governed
      .filter((workspace): workspace is WorkspaceRow => workspace !== null)
      .sort((left, right) => compareWorkspaceRows(left, right, input.sortBy, input.sortOrder))
    const page = sorted.slice(input.offset, input.offset + input.limit)
    const details = await getPublicWorkspaceDetails(page.map(({ id }) => id))
    const workspaces = page.map(({ id }) => {
      const workspace = details.get(id)
      if (!workspace) throw new Error(`Accessible workspace ${id} disappeared during listing`)
      return workspace
    })

    return {
      workspaces,
      hasMore: sorted.length > input.offset + input.limit,
      offset: input.offset,
      limit: input.limit,
    }
  },
}
