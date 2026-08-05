import { type Command, Option } from 'commander'
import { clientFrom } from '../../context.js'
import {
  type ListFileFoldersResponse,
  type ListFilesResponse,
  type ListKnowledgeBasesResponse,
  type ListKnowledgeFoldersResponse,
  type ListTableFoldersResponse,
  type ListTablesResponse,
  type ListWorkflowFoldersResponse,
  type ListWorkflowsResponse,
  V2_OPERATIONS,
  type V2OperationName,
} from '../../generated/v2-api.js'
import { SimApiError, type SimClient, type V2Page } from '../../http/client.js'
import { type Column, printList, text, timestamp } from '../../output/render.js'
import { DEFAULT_LIMIT } from '../../runtime/options.js'

type FolderListOperation =
  | 'listFileFolders'
  | 'listKnowledgeFolders'
  | 'listTableFolders'
  | 'listWorkflowFolders'

type DirectoryResource =
  | ListFilesResponse['data'][number]
  | ListKnowledgeBasesResponse['data'][number]
  | ListTablesResponse['data'][number]
  | ListWorkflowsResponse['data'][number]

type DirectoryFolder =
  | ListFileFoldersResponse['data'][number]
  | ListKnowledgeFoldersResponse['data'][number]
  | ListTableFoldersResponse['data'][number]
  | ListWorkflowFoldersResponse['data'][number]

interface DirectoryEntry {
  kind: string
  name: string
  ref: string
  folderPath: string
  updatedAt: string
}

type ResourceDirectoryConfig =
  | { kind: 'file'; resources: 'listFiles'; folders: 'listFileFolders' }
  | {
      kind: 'knowledge'
      resources: 'listKnowledgeBases'
      folders: 'listKnowledgeFolders'
    }
  | { kind: 'table'; resources: 'listTables'; folders: 'listTableFolders' }
  | { kind: 'workflow'; resources: 'listWorkflows'; folders: 'listWorkflowFolders' }

interface ListOptions {
  folder: string
  search?: string
  limit: string
}

const COLUMNS: Column<DirectoryEntry>[] = [
  { header: 'kind', value: (entry) => text(entry.kind) },
  { header: 'name', value: (entry) => text(entry.name) },
  { header: 'ref', value: (entry) => text(entry.ref) },
  { header: 'folder', value: (entry) => text(entry.folderPath) },
  { header: 'updated', value: (entry) => timestamp(entry.updatedAt) },
]

function operationPath(operation: V2OperationName): string {
  return V2_OPERATIONS[operation].path
}

async function listResources(
  client: SimClient,
  config: ResourceDirectoryConfig,
  workspaceId: string,
  folderPath: string,
  search: string | undefined,
  limit: number
): Promise<DirectoryResource[]> {
  const query = { workspaceId, folderPath, search, sortBy: 'name', sortOrder: 'asc' }
  const path = operationPath(config.resources)
  const paginated = 'cursor' in V2_OPERATIONS[config.resources].query

  if (!paginated) {
    const page = await client.request<V2Page<DirectoryResource>>(path, { query })
    return page.data.slice(0, limit)
  }

  const resources: DirectoryResource[] = []
  let cursor: string | null = null

  do {
    const remaining = limit - resources.length
    const pageSize = Math.min(remaining, DEFAULT_LIMIT)
    const page: V2Page<DirectoryResource> = await client.request(path, {
      query: { ...query, limit: pageSize, cursor },
    })
    resources.push(...page.data)
    cursor = page.nextCursor
  } while (cursor && resources.length < limit)

  return resources.slice(0, limit)
}

async function listFolders(
  client: SimClient,
  operation: FolderListOperation,
  workspaceId: string,
  parentPath: string,
  search: string | undefined
): Promise<DirectoryFolder[]> {
  const page = await client.request<V2Page<DirectoryFolder>>(operationPath(operation), {
    query: { workspaceId, parentPath, search, sortBy: 'name', sortOrder: 'asc' },
  })
  return page.data
}

function entriesFor(
  config: ResourceDirectoryConfig,
  folders: DirectoryFolder[],
  resources: DirectoryResource[]
): DirectoryEntry[] {
  return [
    ...folders.map((folder) => ({
      kind: 'folder',
      name: folder.name,
      ref: folder.path,
      folderPath: folder.parentPath,
      updatedAt: folder.updatedAt,
    })),
    ...resources.map((resource) => ({
      kind: config.kind,
      name: resource.name,
      ref: resource.id,
      folderPath: resource.folderPath,
      updatedAt: resource.updatedAt,
    })),
  ].sort(
    (left, right) => left.name.localeCompare(right.name) || left.kind.localeCompare(right.kind)
  )
}

export function attachResourceList(group: Command, config: ResourceDirectoryConfig): void {
  group
    .command('ls')
    .description(`List ${config.kind} resources and child folders together`)
    .option('--folder <path>', 'Canonical folder path to list', '/')
    .option('--search <text>', 'Filter folders and resources by name')
    .addOption(
      new Option('--limit <n>', 'Maximum combined items to return (0 for everything)').default(
        String(DEFAULT_LIMIT)
      )
    )
    .action(async (options: ListOptions, command: Command) => {
      const rawLimit = Number(options.limit)
      if (!Number.isSafeInteger(rawLimit) || rawLimit < 0) {
        throw new SimApiError('--limit must be a non-negative integer', 0)
      }

      const limit = rawLimit === 0 ? Number.POSITIVE_INFINITY : rawLimit
      const { client, profile } = clientFrom(command)
      const workspaceId = client.requireWorkspace()
      const [folders, resources] = await Promise.all([
        listFolders(client, config.folders, workspaceId, options.folder, options.search),
        listResources(client, config, workspaceId, options.folder, options.search, limit),
      ])
      const entries = entriesFor(config, folders, resources)
      printList(profile.output, entries.slice(0, limit), COLUMNS)
    })
}
