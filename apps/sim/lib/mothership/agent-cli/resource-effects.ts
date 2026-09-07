import type { z } from 'zod'
import type { AnyApiRouteContract } from '@/lib/api/contracts/types'
import * as files from '@/lib/api/contracts/v2/files'
import * as knowledge from '@/lib/api/contracts/v2/knowledge'
import * as chunks from '@/lib/api/contracts/v2/knowledge-chunks'
import * as tags from '@/lib/api/contracts/v2/knowledge-tags'
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
  project: (response: Response, context: EffectContext) => Promise<ResourceChange[]>
}

type ResourceKind = ResourceAddress['type']

function refresh(type: ResourceKind, id?: string): ResourceChange[] {
  return [{ op: 'refresh', resource: { type, ...(id ? { id } : {}) } }]
}

function upsert(
  type: ResourceKind,
  value: { id: string; name?: string; folderPath?: string }
): ResourceChange[] {
  return [
    {
      op: 'upsert',
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

/** Nested writes invalidate their canonical parent; IDs of rows/jobs never become panel IDs. */
function parentWrites(
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
      typeof value.path !== 'string' ||
      value.method === 'GET' ||
      !value.path.includes(`[${parameter}]`) ||
      /\/query(?:\/count)?$/.test(value.path)
    )
      return []
    return [
      {
        method: value.method,
        path: value.path,
        async project(_response: Response, context: EffectContext) {
          return refresh(type, context.params[parameter])
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

const EFFECT_ROUTES: EffectRoute[] = [
  after(workflows.v2CreateWorkflowContract, ({ data }) => upsert('workflow', data)),
  after(workflows.v2ImportWorkflowContract, ({ data }) => upsert('workflow', data)),
  after(workflows.v2DuplicateWorkflowContract, ({ data }) => upsert('workflow', data)),
  after(workflows.v2RestoreWorkflowContract, ({ data }) => upsert('workflow', data)),
  after(workflows.v2UpdateWorkflowContract, ({ data }) => upsert('workflow', data)),
  after(workflows.v2DeleteWorkflowContract, ({ data }) => [
    { op: 'remove', resource: { type: 'workflow', id: data.id } },
  ]),
  after(workflows.v2ReplaceWorkflowStateContract, ({ data }) =>
    data.dryRun ? [] : upsert('workflow', data)
  ),
  after(workflows.v2ApplyWorkflowOperationsContract, ({ data }) =>
    data.dryRun ? [] : upsert('workflow', data)
  ),
  after(workflows.v2ApplyWorkflowVariablesContract, ({ data }) =>
    data.changed ? upsert('workflow', data) : []
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
  ...parentWrites(workflows, 'workflow', 'workflowId'),
  ...parentWrites(tables, 'table', 'tableId'),
  ...parentWrites(knowledge, 'knowledgebase', 'knowledgeBaseId'),
  ...parentWrites(tags, 'knowledgebase', 'knowledgeBaseId'),
  ...parentWrites(chunks, 'knowledgebase', 'knowledgeBaseId'),
  ...parentWrites(files, 'file', 'fileId'),
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
  effects: ResourceChange[]
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
    if (route && response.ok) {
      const params = matchParams(route.path, url.pathname)
      if (params) effects.push(...(await route.project(response, { params, body })))
    }
    return response
  }
}
