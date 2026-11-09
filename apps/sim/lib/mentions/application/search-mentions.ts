import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { listLogsQuerySchema } from '@/lib/api/contracts/logs'
import {
  MENTION_FAMILIES,
  type MentionFamily,
  type MentionRow,
} from '@/lib/api/contracts/organization-mentions'
import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import { asOrchestrationError, OrchestrationError } from '@/lib/core/orchestration/types'
import { readWorkspaceDashboard } from '@/lib/dashboards/application/dashboards'
import { listWorkspaceFoldersUseCase } from '@/lib/folders/application/list-folders'
import { listInternalKnowledgeBases } from '@/lib/knowledge/application/knowledge-bases'
import { listLogsUseCase } from '@/lib/logs/application/list-logs'
import { mentionOperations } from '@/lib/mentions/application/operations'
import { listWorkspaceChats } from '@/lib/mothership/chat/application/use-cases'
import { listAvailableSkillsUseCase } from '@/lib/skills/application/use-cases'
import { listTableDefinitionsUseCase } from '@/lib/table/application/tables'
import { listWorkspaceWorkflowItemsUseCase } from '@/lib/workflows/application/list-workflows'
import { isBuiltinSkillId } from '@/lib/workflows/skills/builtin-skills'
import { listWorkspaceFileFoldersOperation } from '@/lib/workspace-files/application/folders'
import {
  listWorkspaceFileCollection,
  searchWorkspaceFiles,
} from '@/lib/workspace-files/application/list-workspace-files'
import { listAccessibleWorkspaceRowsForUser } from '@/lib/workspaces/utils'

const logger = createLogger('SearchMentions')

/** The most recently updated files a workspace offers before anything is typed. */
const RECENT_FILE_LIMIT = 100
/** The file search's own picker cap. */
const FILE_SEARCH_LIMIT = 50
/** The latest runs a workspace offers. */
const LOG_LIMIT = 50
/** Workspaces read at once; each reads its families in parallel. */
const WORKSPACE_READ_CONCURRENCY = 4

interface SearchMentionsInput {
  organizationId: string
  query: string
  workspaceId?: string
  family?: MentionFamily
  folderId?: string
  limit: number
}

export interface SearchMentionsResult {
  rows: MentionRow[]
  families?: MentionFamily[]
  unavailableWorkspaces: { id: string; name: string }[]
}

interface MentionWorkspace {
  id: string
  name: string
  updatedAt: number
}

interface Candidate {
  row: MentionRow
  updatedAt: number
  /** The folder holding the row, or the parent of a folder row; `null` at the root. */
  parentId?: string | null
}

type ResourceFamily = Exclude<MentionFamily, 'workspaces'>
type FamilyReader = (
  principal: Principal,
  workspace: MentionWorkspace,
  query: string
) => Promise<Candidate[]>

const time = (value: Date | string) => new Date(value).getTime()

function owned(
  family: ResourceFamily,
  workspace: MentionWorkspace,
  record: { id: string; name: string },
  extra: Partial<MentionRow> = {}
): MentionRow {
  return {
    family,
    id: record.id,
    name: record.name,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    ...extra,
  }
}

const FOLDER_FAMILIES = [
  ['workflow', 'Workflow folders'],
  ['table', 'Table folders'],
  ['knowledge_base', 'Knowledge base folders'],
] as const

/** Each family through the workspace operation its own list route runs. */
const READERS: Record<ResourceFamily, FamilyReader> = {
  async workflows(principal, workspace) {
    const workflows = await listWorkspaceWorkflowItemsUseCase.execute({
      principal,
      input: { workspaceId: workspace.id, scope: 'active' },
    })
    return workflows.map((workflow) => ({
      row: owned('workflows', workspace, workflow),
      updatedAt: time(workflow.updatedAt),
      parentId: workflow.folderId,
    }))
  },
  async skills(principal, workspace) {
    const { skills } = await listAvailableSkillsUseCase.execute({
      principal,
      input: { workspaceId: workspace.id },
    })
    return skills.map((skill) => ({
      row: isBuiltinSkillId(skill.id)
        ? { family: 'skills', id: skill.id, name: skill.name, detail: skill.description }
        : owned('skills', workspace, skill, { detail: skill.description }),
      updatedAt: time(skill.updatedAt),
    }))
  },
  async chats(principal, workspace) {
    const chats = await listWorkspaceChats.execute({
      principal,
      input: { workspaceId: workspace.id, scope: 'active' },
    })
    return chats.map((chat) => ({
      row: owned('chats', workspace, { id: chat.id, name: chat.title ?? 'New chat' }),
      updatedAt: time(chat.updatedAt),
    }))
  },
  async tables(principal, workspace) {
    const { tables } = await listTableDefinitionsUseCase.execute({
      principal,
      input: { workspaceId: workspace.id, scope: 'active' },
    })
    return tables.map((table) => ({
      row: owned('tables', workspace, table),
      updatedAt: time(table.updatedAt),
      parentId: table.folderId ?? null,
    }))
  },
  async files(principal, workspace, query) {
    const { files } = query
      ? await searchWorkspaceFiles.execute({
          principal,
          input: { workspaceId: workspace.id, query, recursive: true, limit: FILE_SEARCH_LIMIT },
        })
      : await listWorkspaceFileCollection.execute({
          principal,
          input: {
            workspaceId: workspace.id,
            scope: 'active',
            page: { sortBy: 'updatedAt', sortOrder: 'desc', limit: RECENT_FILE_LIMIT },
          },
        })
    return files.map((file) => ({
      row: owned('files', workspace, file, query ? { matchedQuery: query } : {}),
      updatedAt: time(file.updatedAt),
      parentId: file.folderId ?? null,
    }))
  },
  async file_folders(principal, workspace) {
    const { folders } = await listWorkspaceFileFoldersOperation.execute({
      principal,
      input: { workspaceId: workspace.id, scope: 'active' },
    })
    return folders.map((folder) => ({
      row: owned('file_folders', workspace, folder),
      updatedAt: time(folder.updatedAt),
      parentId: folder.parentId,
    }))
  },
  async knowledge_bases(principal, workspace) {
    const { knowledgeBases } = await listInternalKnowledgeBases.execute({
      principal,
      input: { workspaceId: workspace.id, scope: 'active', includeCounts: false },
    })
    return knowledgeBases.map((base) => ({
      row: owned('knowledge_bases', workspace, base),
      updatedAt: time(base.updatedAt),
      parentId: base.folderId,
    }))
  },
  async dashboards(principal, workspace) {
    const { dashboard } = await readWorkspaceDashboard.execute({
      principal,
      input: { workspaceId: workspace.id },
    })
    return dashboard
      ? [{ row: owned('dashboards', workspace, dashboard), updatedAt: time(dashboard.updatedAt) }]
      : []
  },
  async folders(principal, workspace) {
    const families = await Promise.all(
      FOLDER_FAMILIES.map(async ([resourceType, folderFamily]) => {
        const folders = await listWorkspaceFoldersUseCase.execute({
          principal,
          input: { workspaceId: workspace.id, resourceType, scope: 'active' },
        })
        return folders.map((folder) => ({
          row: owned('folders', workspace, folder, { folderFamily }),
          updatedAt: time(folder.updatedAt),
          parentId: folder.parentId,
        }))
      })
    )
    return families.flat()
  },
  async logs(principal, workspace) {
    const { data } = await listLogsUseCase.execute({
      principal,
      input: listLogsQuerySchema.parse({
        workspaceId: workspace.id,
        limit: LOG_LIMIT,
        sortBy: 'date',
        sortOrder: 'desc',
      }),
    })
    return data.map((log) => {
      const executionId = log.executionId ?? log.id
      return {
        row: owned(
          'logs',
          workspace,
          { id: executionId, name: log.workflow?.name ?? log.workflowId ?? 'Unknown' },
          {
            executionId,
            createdAt: log.createdAt,
            workflowLabel: log.workflow?.name ?? log.workflowId ?? 'Unknown',
          }
        ),
        updatedAt: time(log.createdAt),
      }
    })
  },
}

/** The family label a query also matches, as the picker lists folder and log rows. */
function familyLabel(row: MentionRow): string | undefined {
  return row.folderFamily ?? (row.family === 'logs' ? 'Logs' : undefined)
}

/**
 * The picker's own ranking for an `@` query: exact name, name prefix, name substring, then a
 * workspace or family match, or a file the server matched by its folder path. `null` drops it.
 */
function rank(row: MentionRow, search: string): number | null {
  const name = row.name.toLowerCase()
  if (name === search) return 0
  if (name.startsWith(search)) return 1
  if (name.includes(search)) return 2
  if (row.matchedQuery?.toLowerCase() === search) return 3
  return [row.workspaceName, familyLabel(row)].some((field) =>
    field?.toLowerCase().includes(search)
  )
    ? 3
    : null
}

/** A suggestion page: the query's best matches, or the most recently updated rows. */
function suggest(candidates: readonly Candidate[], query: string, limit: number): MentionRow[] {
  const search = query.toLowerCase()
  const ranked = candidates.flatMap((candidate) => {
    const order = search ? rank(candidate.row, search) : 0
    return order === null ? [] : [{ candidate, order }]
  })
  return ranked
    .sort(
      (left, right) =>
        left.order - right.order || right.candidate.updatedAt - left.candidate.updatedAt
    )
    .slice(0, limit)
    .map(({ candidate }) => candidate.row)
}

function isDenial(error: unknown): boolean {
  const code = asOrchestrationError(error)?.code
  return code === 'forbidden' || code === 'not_found' || code === 'unauthorized'
}

/**
 * Reads one workspace's families. A family its own operation refuses is absent, as its list was
 * for the legacy picker; any other failure fails the workspace, which the caller reports.
 */
async function readWorkspace(
  principal: Principal,
  workspace: MentionWorkspace,
  families: readonly ResourceFamily[],
  query: string
): Promise<Map<ResourceFamily, Candidate[]>> {
  const read = await Promise.all(
    families.map(async (family) => {
      try {
        return [family, await READERS[family](principal, workspace, query)] as const
      } catch (error) {
        if (isDenial(error)) return [family, []] as const
        throw error
      }
    })
  )
  return new Map(read)
}

async function readWorkspaces(
  principal: Principal,
  workspaces: readonly MentionWorkspace[],
  families: readonly ResourceFamily[],
  query: string
) {
  const read = new Map<string, Map<ResourceFamily, Candidate[]>>()
  const unavailable: MentionWorkspace[] = []
  let next = 0
  async function worker() {
    for (let index = next++; index < workspaces.length; index = next++) {
      const workspace = workspaces[index]
      try {
        read.set(workspace.id, await readWorkspace(principal, workspace, families, query))
      } catch (error) {
        logger.warn('Mention reads failed for a workspace', {
          workspaceId: workspace.id,
          error: getErrorMessage(error),
        })
        unavailable.push(workspace)
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(WORKSPACE_READ_CONCURRENCY, workspaces.length) }, worker)
  )
  const candidates = (family: ResourceFamily) =>
    workspaces.flatMap((workspace) => read.get(workspace.id)?.get(family) ?? [])
  return {
    candidates,
    unavailableWorkspaces: unavailable.map(({ id, name }) => ({ id, name })),
  }
}

/** Built-in skills belong to no workspace; each lists once, as the first workspace offers it. */
function uniqueSkills(candidates: readonly Candidate[]): Candidate[] {
  const seen = new Set<string>()
  return candidates.filter(({ row }) => {
    if (row.workspaceId) return true
    if (seen.has(row.id)) return false
    seen.add(row.id)
    return true
  })
}

function workspaceRow(workspace: MentionWorkspace): Candidate {
  return {
    row: {
      family: 'workspaces',
      id: workspace.id,
      name: workspace.name,
      workspaceId: workspace.id,
    },
    updatedAt: workspace.updatedAt,
  }
}

const RESOURCE_FAMILIES = MENTION_FAMILIES.filter(
  (family): family is ResourceFamily => family !== 'workspaces'
)
/** What an `@` names: every family but skills, which the `/` picker lists. */
const AT_FAMILIES = RESOURCE_FAMILIES.filter((family) => family !== 'skills')

/**
 * What a composer may mention across the viewer's workspaces in one organization, in one read:
 * an `@` query's best matches per family (the most recent rows when empty), one browsed workspace's
 * families and their first rows, one family's page in a workspace or folder, or every skill.
 */
export const searchMentions = defineAuthorizedOrganizationUseCase({
  operation: mentionOperations.search,
  async execute({
    principal,
    input,
    context,
  }: OrganizationUseCaseContext<SearchMentionsInput>): Promise<SearchMentionsResult> {
    const accessible = await listAccessibleWorkspaceRowsForUser(
      context.userId,
      'active',
      context.organizationId
    )
    const all = accessible.map(({ workspace }) => ({
      id: workspace.id,
      name: workspace.name,
      updatedAt: workspace.updatedAt.getTime(),
    }))
    const workspaces = input.workspaceId
      ? all.filter((workspace) => workspace.id === input.workspaceId)
      : all
    if (input.workspaceId && !workspaces.length)
      throw new OrchestrationError('not_found', 'Workspace not found')

    if (input.family === 'workspaces')
      return {
        rows: suggest(workspaces.map(workspaceRow), input.query, input.limit),
        unavailableWorkspaces: [],
      }

    if (input.family) {
      const family = input.family
      const { candidates, unavailableWorkspaces } = await readWorkspaces(
        principal,
        workspaces,
        [family],
        input.query
      )
      const rows =
        family === 'skills'
          ? uniqueSkills(candidates(family))
          : candidates(family).filter(
              (candidate) => input.folderId === undefined || candidate.parentId === input.folderId
            )
      return {
        rows: input.query
          ? suggest(rows, input.query, input.limit)
          : rows.slice(0, input.limit).map(({ row }) => row),
        unavailableWorkspaces,
      }
    }

    const families = AT_FAMILIES
    const { candidates, unavailableWorkspaces } = await readWorkspaces(
      principal,
      workspaces,
      families,
      input.query
    )
    if (input.workspaceId) {
      const present = families.filter((family) => candidates(family).length > 0)
      return {
        rows: present.flatMap((family) =>
          candidates(family)
            .slice(0, input.limit)
            .map(({ row }) => row)
        ),
        families: present,
        unavailableWorkspaces,
      }
    }
    return {
      rows: [
        ...suggest(workspaces.map(workspaceRow), input.query, input.limit),
        ...families.flatMap((family) => suggest(candidates(family), input.query, input.limit)),
      ],
      unavailableWorkspaces,
    }
  },
})
