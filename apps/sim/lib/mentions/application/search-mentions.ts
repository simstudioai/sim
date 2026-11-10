import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  MENTION_FAMILIES,
  type MentionFamily,
  type MentionListFamily,
  type MentionRow,
} from '@/lib/api/contracts/organization-mentions'
import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import type { ApplicationOperation } from '@/lib/core/application/operation'
import { dashboardOperations } from '@/lib/dashboards/application/operations'
import { isDashboardsEnabled } from '@/lib/dashboards/feature-flag'
import { folderOperations } from '@/lib/folders/application/operations'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { logOperations } from '@/lib/logs/application/operations'
import { mentionOperations } from '@/lib/mentions/application/operations'
import {
  type MentionReadSpec,
  type MentionRecord,
  readChatMentions,
  readDashboardMentions,
  readFileFolderMentions,
  readFileMentions,
  readFolderMentions,
  readKnowledgeBaseMentions,
  readLogMentions,
  readSkillMentions,
  readTableMentions,
  readWorkflowMentions,
} from '@/lib/mentions/queries'
import { mothershipChatOperations } from '@/lib/mothership/chat/application/operations'
import { isWorkspaceCapabilityWithheld } from '@/lib/permission-groups/capability-assertions'
import { skillOperations } from '@/lib/skills/application/operations'
import { tableOperations } from '@/lib/table/application/operations'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { listAccessibleWorkspaceRowsForUser } from '@/lib/workspaces/utils'

const logger = createLogger('SearchMentions')

interface SearchMentionsInput {
  organizationId: string
  query: string
  family?: MentionListFamily
  limit: number
}

export interface SearchMentionsResult {
  rows: MentionRow[]
  unavailableWorkspaces: { id: string; name: string }[]
  unavailableFamilies: MentionFamily[]
}

interface MentionWorkspace {
  id: string
  name: string
  updatedAt: Date
}

type ResourceFamily = Exclude<MentionFamily, 'workspaces'>

interface FamilyReadContext {
  userId: string
  organizationId: string
}

/**
 * Each family's batched read and the workspace operation its own list route authorizes. Every
 * operation here requires the read role, which each accessible workspace grants, so what remains
 * per workspace is the operation's permission-group capability.
 */
const FAMILIES: Record<
  ResourceFamily,
  {
    operation: ApplicationOperation
    read(spec: MentionReadSpec, context: FamilyReadContext): Promise<MentionRecord[]>
    /** An organization-wide switch the family's operation also requires. */
    enabled?(context: FamilyReadContext): Promise<boolean>
  }
> = {
  workflows: { operation: workflowOperations.list, read: readWorkflowMentions },
  skills: { operation: skillOperations.listAvailable, read: readSkillMentions },
  chats: {
    operation: mothershipChatOperations.listWorkspace,
    read: (spec, { userId }) => readChatMentions(spec, userId),
  },
  tables: { operation: tableOperations.list, read: readTableMentions },
  files: { operation: fileOperations.list, read: readFileMentions },
  file_folders: { operation: fileOperations.listFolders, read: readFileFolderMentions },
  knowledge_bases: { operation: knowledgeOperations.list, read: readKnowledgeBaseMentions },
  dashboards: {
    operation: dashboardOperations.read,
    read: readDashboardMentions,
    enabled: ({ organizationId }) => isDashboardsEnabled(organizationId),
  },
  folders: {
    operation: folderOperations.list,
    read: (spec) => readFolderMentions(spec, ['workflow', 'table', 'knowledge_base']),
  },
  logs: { operation: logOperations.list, read: readLogMentions },
}

const RESOURCE_FAMILIES = MENTION_FAMILIES.filter(
  (family): family is ResourceFamily => family !== 'workspaces'
)
/** What an `@` names: every family but skills, which the `/` picker lists. */
const AT_FAMILIES = RESOURCE_FAMILIES.filter((family) => family !== 'skills')

/**
 * The workspaces each family may read: those whose permission group leaves its operation's
 * capability. Each workspace's config resolves once (configs are cached) and serves every family;
 * a workspace whose config cannot be read is reported and read for nothing.
 */
async function readableWorkspaces(
  context: FamilyReadContext,
  workspaces: readonly MentionWorkspace[],
  families: readonly ResourceFamily[]
) {
  const capabilities = [
    ...new Set(
      families.flatMap((family) => {
        const { capability } = FAMILIES[family].operation
        return capability === 'none' ? [] : [capability]
      })
    ),
  ]
  const withheld = new Map<string, Set<string>>()
  const unavailable: MentionWorkspace[] = []
  await Promise.all(
    workspaces.map(async (workspace) => {
      try {
        const denied = await Promise.all(
          capabilities.map(async (capability) =>
            (await isWorkspaceCapabilityWithheld(
              context.userId,
              workspace.id,
              capability,
              context.organizationId
            ))
              ? [capability]
              : []
          )
        )
        withheld.set(workspace.id, new Set<string>(denied.flat()))
      } catch (error) {
        logger.warn('Mention access could not be read for a workspace', {
          workspaceId: workspace.id,
          error: getErrorMessage(error),
        })
        unavailable.push(workspace)
      }
    })
  )
  const enabled = new Map(
    await Promise.all(
      families.map(
        async (family) => [family, (await FAMILIES[family].enabled?.(context)) ?? true] as const
      )
    )
  )
  return {
    unavailableWorkspaces: unavailable.map(({ id, name }) => ({ id, name })),
    workspaceIdsFor(family: ResourceFamily): string[] {
      if (!enabled.get(family)) return []
      const { capability } = FAMILIES[family].operation
      return workspaces.flatMap(({ id }) => {
        const denied = withheld.get(id)
        return denied && (capability === 'none' || !denied.has(capability)) ? [id] : []
      })
    },
  }
}

function toRow(
  family: ResourceFamily,
  record: MentionRecord,
  names: ReadonlyMap<string, string>
): MentionRow {
  return {
    family,
    id: record.id,
    name: record.name,
    ...(record.workspaceId
      ? { workspaceId: record.workspaceId, workspaceName: names.get(record.workspaceId) }
      : {}),
    ...(record.folderFamily ? { folderFamily: record.folderFamily } : {}),
    ...(record.detail !== undefined ? { detail: record.detail } : {}),
    ...(record.executionId
      ? {
          executionId: record.executionId,
          createdAt: record.updatedAt.toISOString(),
          workflowLabel: record.workflowLabel,
        }
      : {}),
  }
}

function workspaceRank(name: string, query: string): number | null {
  if (!query || name === query) return 0
  if (name.startsWith(query)) return 1
  return name.includes(query) ? 2 : null
}

/** The picker's ranking of the workspaces themselves, which are already in hand. */
function workspaceRows(workspaces: readonly MentionWorkspace[], query: string, limit: number) {
  return workspaces
    .flatMap((workspace) => {
      const order = workspaceRank(workspace.name.toLowerCase(), query)
      return order === null ? [] : [{ workspace, order }]
    })
    .sort(
      (left, right) =>
        left.order - right.order ||
        right.workspace.updatedAt.getTime() - left.workspace.updatedAt.getTime()
    )
    .slice(0, limit)
    .map(
      ({ workspace }): MentionRow => ({
        family: 'workspaces',
        id: workspace.id,
        name: workspace.name,
        workspaceId: workspace.id,
      })
    )
}

/**
 * What a composer may mention across the viewer's workspaces in one organization: an `@` query's
 * best rows per family (the most recently updated when empty), the organization's workspaces, or
 * every skill. Each family is one query across the workspaces its operation allows.
 */
export const searchMentions = defineAuthorizedOrganizationUseCase({
  operation: mentionOperations.search,
  async execute({
    input,
    context,
  }: OrganizationUseCaseContext<SearchMentionsInput>): Promise<SearchMentionsResult> {
    const accessible = await listAccessibleWorkspaceRowsForUser(
      context.userId,
      'active',
      context.organizationId
    )
    const workspaces = accessible.map(({ workspace }) => ({
      id: workspace.id,
      name: workspace.name,
      updatedAt: workspace.updatedAt,
    }))
    const query = input.query.toLowerCase()

    if (input.family === 'workspaces')
      return {
        rows: workspaceRows(workspaces, query, input.limit),
        unavailableWorkspaces: [],
        unavailableFamilies: [],
      }

    const names = new Map(workspaces.map(({ id, name }) => [id, name]))
    const matchedWorkspaceIds = query
      ? workspaces
          .filter((workspace) => workspace.name.toLowerCase().includes(query))
          .map(({ id }) => id)
      : []
    const families: readonly ResourceFamily[] = input.family ? [input.family] : AT_FAMILIES
    const readContext = { userId: context.userId, organizationId: context.organizationId }
    const access = await readableWorkspaces(readContext, workspaces, families)
    const unavailableFamilies: MentionFamily[] = []
    const read = new Map<ResourceFamily, MentionRecord[]>(
      await Promise.all(
        families.map(async (family): Promise<[ResourceFamily, MentionRecord[]]> => {
          try {
            return [
              family,
              await FAMILIES[family].read(
                {
                  workspaceIds: access.workspaceIdsFor(family),
                  query,
                  matchedWorkspaceIds,
                  limit: input.limit,
                },
                readContext
              ),
            ]
          } catch (error) {
            logger.warn('Mention family read failed', { family, error: getErrorMessage(error) })
            unavailableFamilies.push(family)
            return [family, []]
          }
        })
      )
    )
    const rows = (family: ResourceFamily) =>
      (read.get(family) ?? []).map((record) => toRow(family, record, names))
    const status = { unavailableWorkspaces: access.unavailableWorkspaces, unavailableFamilies }

    if (input.family) return { rows: rows(input.family), ...status }
    return {
      rows: [...workspaceRows(workspaces, query, input.limit), ...families.flatMap(rows)],
      ...status,
    }
  },
})
