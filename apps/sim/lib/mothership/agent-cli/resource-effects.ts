import type { z } from 'zod'
import type { AnyApiRouteContract } from '@/lib/api/contracts/types'
import * as credentials from '@/lib/api/contracts/v2/credentials'
import * as customTools from '@/lib/api/contracts/v2/custom-tools'
import * as files from '@/lib/api/contracts/v2/files'
import * as knowledge from '@/lib/api/contracts/v2/knowledge'
import * as chunks from '@/lib/api/contracts/v2/knowledge-chunks'
import * as tags from '@/lib/api/contracts/v2/knowledge-tags'
import * as logs from '@/lib/api/contracts/v2/logs'
import * as logStats from '@/lib/api/contracts/v2/logs-stats'
import * as mcpServers from '@/lib/api/contracts/v2/mcp-servers'
import * as sandboxes from '@/lib/api/contracts/v2/sandboxes'
import * as secrets from '@/lib/api/contracts/v2/secrets'
import * as tables from '@/lib/api/contracts/v2/tables'
import * as workflows from '@/lib/api/contracts/v2/workflows'
import { parseFolderPath } from '@/lib/folders/paths'
import type { ResourceAddress, ResourceChange } from '@/lib/mothership/generated/resources'
import { encodeVfsPathSegments } from '@/lib/vfs/path'

interface EffectContext {
  params: Record<string, string>
  body?: unknown
}

interface EffectRoute {
  method: string
  path: string
  readBody?: boolean
  readOnly?: boolean
  project: (response: Response, context: EffectContext) => Promise<ResourceChange[]>
}

type ResourceKind = ResourceAddress['type']

function refresh(type: ResourceKind, id?: string): ResourceChange[] {
  return [{ op: 'refresh', resource: { type, ...(id ? { id } : {}) } }]
}

function upsert(
  type: ResourceKind,
  value: { id: string; name?: string; folderPath?: string },
  readOnly = false
): ResourceChange[] {
  return [
    {
      op: 'upsert',
      ...(readOnly ? { readOnly: true as const } : {}),
      resource: {
        type,
        id: value.id,
        ...(value.name ? { title: value.name } : {}),
        ...(type === 'file' && value.name && value.folderPath !== undefined
          ? {
              path: `files/${encodeVfsPathSegments([...parseFolderPath(value.folderPath), value.name])}`,
            }
          : {}),
      },
    },
  ]
}

/** Response schemas are owned by the operation, before CLI formatting can discard identity. */
function after<S extends z.ZodType>(
  contract: Pick<AnyApiRouteContract, 'method' | 'path'> & { response: { schema: S } },
  project: (value: z.output<S>, context: EffectContext) => ResourceChange[]
): EffectRoute {
  return {
    method: contract.method,
    path: contract.path,
    async project(response, context) {
      return project(contract.response.schema.parse(await response.clone().json()), context)
    },
  }
}

/** Successful scoped operations address their parent; row/job IDs never become panel IDs. */
function parentAccess(
  contracts: Record<string, unknown>,
  type: ResourceKind,
  parameter: string
): EffectRoute[] {
  return Object.values(contracts).flatMap((value) => {
    if (
      !value ||
      typeof value !== 'object' ||
      !('method' in value) ||
      !('path' in value) ||
      typeof value.method !== 'string' ||
      typeof value.path !== 'string'
    )
      return []
    const readOnly = value.method === 'GET' || /\/query(?:\/count)?$/.test(value.path)
    return [
      {
        method: value.method,
        path: value.path,
        readOnly,
        async project(_response: Response, context: EffectContext) {
          /** Literal collection routes also match, preventing /folders from becoming an ID. */
          const id = context.params[parameter]
          return id ? upsert(type, { id }, readOnly) : []
        },
      },
    ]
  })
}

function folders(contracts: Record<string, unknown>, type: ResourceKind): EffectRoute[] {
  return Object.values(contracts).flatMap((value) => {
    if (
      !value ||
      typeof value !== 'object' ||
      !('method' in value) ||
      !('path' in value) ||
      typeof value.method !== 'string' ||
      typeof value.path !== 'string' ||
      value.method === 'GET' ||
      !/\/folders(?:\/restore)?$/.test(value.path)
    )
      return []
    return [
      {
        method: value.method,
        path: value.path,
        async project() {
          return [...refresh(type), ...refresh(type === 'file' ? 'filefolder' : 'folder')]
        },
      },
    ]
  })
}

function settingsMutations(
  section: string,
  contracts: Pick<AnyApiRouteContract, 'method' | 'path'>[]
): EffectRoute[] {
  return contracts.map(({ method, path }) => ({
    method,
    path,
    async project() {
      return [{ op: 'refresh', resource: { type: 'settings', scope: 'workspace', id: section } }]
    },
  }))
}

const EFFECT_ROUTES: EffectRoute[] = [
  ...settingsMutations('secrets', [secrets.v2SetSecretContract, secrets.v2DeleteSecretContract]),
  ...settingsMutations('credentials', [
    credentials.v2CreateCredentialConnectionContract,
    credentials.v2CreateServiceAccountCredentialContract,
    credentials.v2UpdateCredentialContract,
    credentials.v2DeleteCredentialContract,
  ]),
  ...settingsMutations('custom-tools', [
    customTools.v2CreateCustomToolContract,
    customTools.v2UpdateCustomToolContract,
    customTools.v2DeleteCustomToolContract,
  ]),
  ...settingsMutations('mcp', [
    mcpServers.v2CreateMcpServerContract,
    mcpServers.v2UpdateMcpServerContract,
    mcpServers.v2DeleteMcpServerContract,
  ]),
  ...settingsMutations('sandboxes', [
    sandboxes.v2CreateSandboxContract,
    sandboxes.v2UpdateSandboxContract,
    sandboxes.v2DeleteSandboxContract,
  ]),
  {
    ...after(workflows.v2GetWorkflowContract, ({ data }) => upsert('workflow', data, true)),
    readOnly: true,
  },
  {
    ...after(tables.v2GetTableContract, ({ data }) => upsert('table', data, true)),
    readOnly: true,
  },
  {
    ...after(tables.v2GetTableViewContract, ({ data }) => [
      {
        op: 'upsert',
        readOnly: true,
        resource: { type: 'table', id: data.tableId, viewId: data.id },
      },
    ]),
    readOnly: true,
  },
  {
    ...after(knowledge.v2GetKnowledgeBaseContract, ({ data }) =>
      upsert('knowledgebase', data, true)
    ),
    readOnly: true,
  },
  { ...after(files.v2GetFileContract, ({ data }) => upsert('file', data, true)), readOnly: true },
  {
    ...after(files.v2ReadFileTextContract, ({ data }) => [
      {
        op: 'upsert',
        readOnly: true,
        resource: { type: 'file', id: data.fileId, title: data.name, path: data.path },
      },
    ]),
    readOnly: true,
  },
  {
    ...after(logs.v2GetLogContract, ({ data }) => [
      {
        op: 'upsert',
        readOnly: true,
        resource: {
          type: 'log',
          id: data.runId,
          executionId: data.runId,
          title: data.workflow.name,
        },
      },
    ]),
    readOnly: true,
  },
  after(workflows.v2CreateWorkflowContract, ({ data }) => upsert('workflow', data)),
  after(workflows.v2ImportWorkflowContract, ({ data }) => upsert('workflow', data)),
  after(workflows.v2DuplicateWorkflowContract, ({ data }) => upsert('workflow', data)),
  after(workflows.v2RestoreWorkflowContract, ({ data }) => upsert('workflow', data)),
  after(workflows.v2UpdateWorkflowContract, ({ data }) => upsert('workflow', data)),
  after(workflows.v2DeleteWorkflowContract, ({ data }) => [
    { op: 'remove', resource: { type: 'workflow', id: data.id } },
  ]),
  after(workflows.v2ReplaceWorkflowStateContract, ({ data }) =>
    upsert('workflow', data, data.dryRun)
  ),
  after(workflows.v2ApplyWorkflowOperationsContract, ({ data }) =>
    upsert('workflow', data, data.dryRun)
  ),
  after(workflows.v2ApplyWorkflowVariablesContract, ({ data }) =>
    upsert('workflow', data, !data.changed)
  ),
  after(workflows.v2MoveWorkflowsContract, () => [...refresh('workflow'), ...refresh('folder')]),
  after(tables.v2CreateTableContract, ({ data }) => upsert('table', data)),
  after(tables.v2UpdateTableContract, ({ data }) => upsert('table', data)),
  after(tables.v2RestoreTableContract, ({ data }) => upsert('table', data)),
  after(tables.v2DeleteTableContract, ({ data }) => [
    { op: 'remove', resource: { type: 'table', id: data.id } },
  ]),
  after(tables.v2CreateTableViewContract, ({ data }) => [
    { op: 'upsert', resource: { type: 'table', id: data.tableId, viewId: data.id } },
  ]),
  after(tables.v2UpdateTableViewContract, ({ data }) => [
    { op: 'upsert', resource: { type: 'table', id: data.tableId, viewId: data.id } },
  ]),
  after(tables.v2DeleteTableViewContract, ({ data }, { params }) => [
    {
      op: 'clear_view',
      resource: {
        type: 'table',
        id: params.tableId,
        viewId: data.id,
      },
    },
  ]),
  after(tables.v2MoveTablesContract, ({ data }) =>
    data.moved.length ? [...refresh('table'), ...refresh('folder')] : []
  ),
  after(tables.v2BulkDeleteTablesContract, ({ data }) =>
    data.deleted.length
      ? [
          ...data.deleted
            .filter((item) => item.kind === 'table')
            .map(
              (item): ResourceChange => ({ op: 'remove', resource: { type: 'table', id: item.id } })
            ),
          ...refresh('table'),
          ...refresh('folder'),
        ]
      : []
  ),
  after(tables.v2GetTableImportContract, ({ data }) =>
    data.tableId ? refresh('table', data.tableId) : []
  ),
  after(tables.v2CompleteTableImportContract, ({ data }) =>
    data.tableId ? refresh('table', data.tableId) : []
  ),
  after(tables.v2CancelTableImportContract, ({ data }) =>
    data.tableId ? refresh('table', data.tableId) : []
  ),
  after(knowledge.v2CreateKnowledgeBaseContract, ({ data }) => upsert('knowledgebase', data)),
  after(knowledge.v2UpdateKnowledgeBaseContract, ({ data }) => upsert('knowledgebase', data)),
  after(knowledge.v2RestoreKnowledgeBaseContract, ({ data }) => upsert('knowledgebase', data)),
  after(knowledge.v2DeleteKnowledgeBaseContract, ({ data }) => [
    { op: 'remove', resource: { type: 'knowledgebase', id: data.id } },
  ]),
  after(files.v2CreateFileContract, ({ data }) => upsert('file', data)),
  after(files.v2RenameFileContract, ({ data }) => upsert('file', data)),
  after(files.v2RestoreFileContract, ({ data }) => upsert('file', data)),
  after(files.v2UpdateFileContentContract, ({ data }) => upsert('file', data)),
  after(files.v2CompleteFileUploadContract, ({ data }) =>
    data.file ? upsert('file', data.file) : []
  ),
  after(files.v2DeleteFileContract, ({ data }) => [
    { op: 'remove', resource: { type: 'file', id: data.id } },
  ]),
  after(files.v2UnzipFileContract, () => [...refresh('file'), ...refresh('filefolder')]),
  after(files.v2MoveFileItemsContract, () => [...refresh('file'), ...refresh('filefolder')]),
  {
    ...after(files.v2BulkDeleteFilesContract, (_result, context) => {
      const body = files.v2BulkDeleteFilesBodySchema.parse(context.body)
      /** Every selected file is validated and archived in one application transaction. */
      return [...new Set(body.fileIds)].map(
        (id): ResourceChange => ({ op: 'remove', resource: { type: 'file', id } })
      )
    }),
    readBody: true,
  },
  ...folders(workflows, 'workflow'),
  ...folders(tables, 'table'),
  ...folders(knowledge, 'knowledgebase'),
  ...folders(files, 'file'),
  ...parentAccess(workflows, 'workflow', 'workflowId'),
  ...parentAccess(tables, 'table', 'tableId'),
  ...parentAccess(knowledge, 'knowledgebase', 'knowledgeBaseId'),
  ...parentAccess(tags, 'knowledgebase', 'knowledgeBaseId'),
  ...parentAccess(chunks, 'knowledgebase', 'knowledgeBaseId'),
  ...parentAccess(files, 'file', 'fileId'),
  ...parentAccess(logStats, 'log', 'runId'),
].sort(
  // Literal endpoints such as /files/folders/restore take precedence over /files/[fileId]/restore.
  (left, right) => (left.path.match(/\[/g)?.length ?? 0) - (right.path.match(/\[/g)?.length ?? 0)
)

function matchParams(pattern: string, pathname: string): Record<string, string> | undefined {
  const expected = pattern.split('/')
  const actual = pathname.split('/')
  if (expected.length !== actual.length) return
  const params: Record<string, string> = {}
  for (const [index, part] of expected.entries()) {
    const segment = actual[index]
    if (segment === undefined) return
    if (part.startsWith('[')) params[part.slice(1, -1)] = decodeURIComponent(segment)
    else if (part !== segment) return
  }
  return params
}

/** The observer adds no request and never reads provider responses or download bodies. */
export function createResourceEffectTransport(
  endpoint: string,
  transport: typeof fetch,
  effects: ResourceChange[],
  observeReads = true
): typeof fetch {
  const origin = new URL(endpoint).origin
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const route =
      url.origin === origin
        ? EFFECT_ROUTES.find(
            (route) => route.method === method && matchParams(route.path, url.pathname)
          )
        : undefined
    const body = route?.readBody
      ? typeof init?.body === 'string'
        ? JSON.parse(init.body)
        : input instanceof Request
          ? await input.clone().json()
          : undefined
      : undefined
    const response = await transport(input, init)
    if (route && response.ok && (!route.readOnly || observeReads)) {
      const params = matchParams(route.path, url.pathname)
      if (params) effects.push(...(await route.project(response, { params, body })))
    }
    return response
  }
}
