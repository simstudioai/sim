import { type Command, Option } from 'commander'
import { clientFrom } from '../../context'
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
} from '../../generated/v2-api'
import { requestAllPages, SimApiError, type SimClient, type V2Page } from '../../http/client'
import { type Column, printList, text, timestamp } from '../../output/render'
import { DEFAULT_PAGE_SIZE } from '../../runtime/options'
import { encodeFolderPath } from '../../runtime/request'
import { decodeFolderPath, renderResult } from '../../runtime/result'

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
  webUrl?: string
  folderPath: string
  updatedAt: string
}

type ResourceDirectoryConfig =
  | {
      kind: 'file'
      resources: 'listFiles'
      folders: 'listFileFolders'
      createFolder: 'createFileFolder'
    }
  | {
      kind: 'knowledge'
      resources: 'listKnowledgeBases'
      folders: 'listKnowledgeFolders'
      createFolder: 'createKnowledgeFolder'
    }
  | {
      kind: 'table'
      resources: 'listTables'
      folders: 'listTableFolders'
      createFolder: 'createTableFolder'
    }
  | {
      kind: 'workflow'
      resources: 'listWorkflows'
      folders: 'listWorkflowFolders'
      createFolder: 'createWorkflowFolder'
    }

interface ListOptions {
  search?: string
  limit: string
}

/**
 * A folder's `ref` is its path, so it decodes like one; a resource's `ref` is an
 * opaque id and is shown as it arrived. Both stay pasteable into the next
 * command because `encodeFolderPath` accepts either form.
 */
const COLUMNS: Column<DirectoryEntry>[] = [
  { header: 'kind', value: (entry) => text(entry.kind) },
  { header: 'name', value: (entry) => text(entry.name) },
  {
    header: 'ref',
    value: (entry) => text(entry.kind === 'folder' ? decodeFolderPath(entry.ref) : entry.ref),
  },
  { header: 'folder', value: (entry) => text(decodeFolderPath(entry.folderPath)) },
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

  return requestAllPages<DirectoryResource>(client, path, {
    query,
    pageSize: DEFAULT_PAGE_SIZE,
    limit,
  })
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
      webUrl: resource.webUrl,
      folderPath: resource.folderPath,
      updatedAt: resource.updatedAt,
    })),
  ].sort(
    (left, right) => left.name.localeCompare(right.name) || left.kind.localeCompare(right.kind)
  )
}

export function attachResourceDirectoryCommands(
  group: Command,
  config: ResourceDirectoryConfig
): void {
  group
    .command('ls')
    .argument('[path]', 'Folder path to list; defaults to the root folder')
    .allowExcessArguments(false)
    .description(`List ${config.kind} resources and child folders together`)
    .option('--search <text>', 'Filter folders and resources by name')
    .addOption(
      new Option('--limit <n>', 'Maximum combined items to return (0 for everything)').default('0')
    )
    .action(async (path: string | undefined, options: ListOptions, command: Command) => {
      const rawLimit = Number(options.limit)
      if (!Number.isSafeInteger(rawLimit) || rawLimit < 0) {
        throw new SimApiError('--limit must be a whole number of 0 or more (0 for everything)', 0)
      }

      const limit = rawLimit === 0 ? Number.POSITIVE_INFINITY : rawLimit
      // These commands build their own request, so the encoding `buildRequest`
      // applies to every contract-driven folder flag has to be applied here too
      // — otherwise `--folder '/Folder 1'` works and `ls '/Folder 1'` does not.
      const folderPath = encodeFolderPath(path ?? '/')
      const { client, profile } = clientFrom(command)
      const workspaceId = client.requireWorkspace()
      const [folders, resources] = await Promise.all([
        listFolders(client, config.folders, workspaceId, folderPath, options.search),
        listResources(client, config, workspaceId, folderPath, options.search, limit),
      ])
      const entries = entriesFor(config, folders, resources)
      const shown = entries.slice(0, limit)
      printList(profile.output, shown, COLUMNS)
    })

  group
    .command('mkdir')
    .argument('<path>', 'Folder path to create; the leading / is optional')
    .allowExcessArguments(false)
    .description(`Create a ${config.kind} directory at a path`)
    .action(async (path: string, _options: Record<string, never>, command: Command) => {
      const { client, profile } = clientFrom(command)
      const operation = V2_OPERATIONS[config.createFolder]
      const result = await client.request<{ data?: unknown }>(operation.path, {
        method: operation.method,
        body: { workspaceId: client.requireWorkspace(), path: encodeFolderPath(path) },
      })
      renderResult(config.createFolder, profile.output, result.data ?? result, {})
    })
}
