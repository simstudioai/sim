import type {
  EloquaApplicationItemOutput,
  EloquaApplicationListOutput,
  EloquaApplicationListParams,
  EloquaApplicationResource,
  EloquaApplicationResourceMap,
  EloquaBulkDefinitionKind,
  EloquaBulkDefinitionMap,
  EloquaBulkDefinitionOutput,
  EloquaBulkDefinitionParams,
  EloquaBulkImportDataParams,
  EloquaBulkItemMap,
  EloquaBulkPageOutput,
  EloquaBulkPageParams,
  EloquaBulkSyncPageParams,
  EloquaBulkSyncParams,
  EloquaBulkUploadOutput,
  EloquaCampaignActionParams,
  EloquaEntityBodyParams,
  EloquaIdParams,
  EloquaResponse,
  EloquaStartSyncParams,
  EloquaSyncOutput,
} from '@/tools/eloqua/types'
import {
  buildEloquaUrl,
  ELOQUA_APPLICATION_LIST_PARAMS,
  ELOQUA_AUTH_PARAMS,
  ELOQUA_BULK_SYNC_OUTPUTS,
  ELOQUA_BULK_UPLOAD_OUTPUTS,
  ELOQUA_ID_PARAM,
  ELOQUA_OAUTH_CONFIG,
  eloquaApplicationItemOutputs,
  eloquaApplicationListOutputs,
  eloquaBulkDefinitionOutputs,
  eloquaBulkListOutputs,
  eloquaCallbackUrl,
  eloquaCampaignSchedule,
  eloquaHeaders,
  eloquaJsonObject,
  eloquaPositiveInteger,
  eloquaResourceId,
  eloquaResourceUri,
  requireEloquaObject,
  validateApplicationPagination,
  validateBulkPagination,
  validateEloquaBulkDefinition,
  validateEloquaSync,
  validateInlineImportData,
} from '@/tools/eloqua/utils'
import type { ToolConfig } from '@/tools/types'

type ToolParams = ToolConfig['params']

interface ApplicationListToolOptions<TResource extends EloquaApplicationResource> {
  id: string
  name: string
  description: string
  path: string
  resource: TResource
  allowNoContent?: boolean
  extraParams?: ToolParams
  query?: (params: EloquaApplicationListParams) => Record<string, unknown>
}

interface ApplicationItemToolOptions<TResource extends EloquaApplicationResource> {
  id: string
  name: string
  description: string
  path: (id: string) => string
  resource: TResource
  extraParams?: ToolParams
  query?: (params: EloquaIdParams) => Record<string, unknown>
}

interface ApplicationMutationToolOptions<TResource extends 'contact' | 'account'> {
  id: string
  name: string
  description: string
  method: 'POST' | 'PUT'
  path: (id?: string) => string
  requiresId?: boolean
  bodyDescription: string
  successStatus: 200 | 201
  resource: TResource
}

interface BulkListToolOptions<TItemKind extends 'contactField' | 'sync'> {
  id: string
  name: string
  description: string
  path: string
  itemKind: TItemKind
}

interface BulkDefinitionToolOptions<TKind extends EloquaBulkDefinitionKind> {
  id: string
  name: string
  description: string
  path: string
  definitionKind: TKind
}

interface BulkSyncPageToolOptions<TItemKind extends 'syncData' | 'syncLog' | 'syncReject'> {
  id: string
  name: string
  description: string
  suffix: '' | '/data' | '/logs' | '/rejects'
  includeSearch?: boolean
  itemKind: TItemKind
  maxLimit: 1_000 | 50_000
}

function bulkPageToolParams(maxLimit: 1_000 | 50_000, includeSearch: boolean): ToolParams {
  return {
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: `Maximum records in this page (up to ${maxLimit})`,
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Zero-based result offset',
    },
    ...(includeSearch
      ? {
          q: {
            type: 'string' as const,
            required: false,
            visibility: 'user-or-llm' as const,
            description: 'Bulk API search expression',
          },
          orderBy: {
            type: 'string' as const,
            required: false,
            visibility: 'user-or-llm' as const,
            description: 'Bulk API ordering expression',
          },
        }
      : {}),
    totalResults: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to calculate and return totalResults',
    },
  }
}

function applicationQuery(params: EloquaApplicationListParams): Record<string, unknown> {
  validateApplicationPagination(params.count, params.page)
  return {
    depth: params.depth,
    count: params.count,
    page: params.page,
    search: params.search,
    orderBy: params.orderBy,
    lastUpdatedAt: params.lastUpdatedAt,
  }
}

function bulkQuery(
  params: EloquaBulkPageParams | EloquaBulkSyncPageParams,
  maxLimit: 1_000 | 50_000
) {
  validateBulkPagination(params.limit, params.offset, maxLimit)
  return {
    limit: params.limit,
    offset: params.offset,
    q: params.q,
    orderBy: params.orderBy,
    totalResults: params.totalResults,
  }
}

function assertStatus(response: Response, expected: readonly number[], label: string): void {
  if (!expected.includes(response.status)) {
    throw new Error(
      `Invalid ${label} response: expected HTTP ${expected.join(' or ')}, received ${response.status}`
    )
  }
}

function numberField(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid Eloqua response: ${name} must be a nonnegative integer`)
  }
  return value
}

function booleanField(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid Eloqua response: ${name} must be a boolean`)
  }
  return value
}

async function transformApplicationList<TEntity>(
  response: Response,
  params: EloquaApplicationListParams | undefined,
  label: string,
  allowNoContent: boolean
): Promise<EloquaResponse<EloquaApplicationListOutput<TEntity>>> {
  if (response.status === 204) {
    if (!allowNoContent) assertStatus(response, [200], label)
    return {
      success: true,
      output: {
        items: [],
        page: params?.page ?? 1,
        pageSize: 0,
        total: 0,
        type: null,
        success: true,
      },
    }
  }
  assertStatus(response, [200], label)
  const data = await eloquaJsonObject(response, label)
  if (
    !Array.isArray(data.elements) ||
    !data.elements.every((item) => item && typeof item === 'object')
  ) {
    throw new Error(`Invalid ${label} response: elements must be an array of objects`)
  }
  return {
    success: true,
    output: {
      items: data.elements as TEntity[],
      page: numberField(data.page, 'page'),
      pageSize: numberField(data.pageSize, 'pageSize'),
      total: numberField(data.total, 'total'),
      type: typeof data.type === 'string' ? data.type : null,
      success: true,
    },
  }
}

async function transformApplicationItem<TEntity>(
  response: Response,
  expectedStatus: 200 | 201,
  label: string
): Promise<EloquaResponse<EloquaApplicationItemOutput<TEntity>>> {
  assertStatus(response, [expectedStatus], label)
  const item = await eloquaJsonObject(response, label)
  return { success: true, output: { item: item as TEntity, success: true } }
}

async function transformBulkPage<TItem>(
  response: Response,
  label: string
): Promise<EloquaResponse<EloquaBulkPageOutput<TItem>>> {
  assertStatus(response, [200], label)
  const data = await eloquaJsonObject(response, label)
  if (!Array.isArray(data.items) || !data.items.every((item) => item && typeof item === 'object')) {
    throw new Error(`Invalid ${label} response: items must be an array of objects`)
  }
  return {
    success: true,
    output: {
      items: data.items as TItem[],
      count: numberField(data.count, 'count'),
      hasMore: booleanField(data.hasMore, 'hasMore'),
      limit: numberField(data.limit, 'limit'),
      offset: numberField(data.offset, 'offset'),
      totalResults:
        data.totalResults === undefined ? null : numberField(data.totalResults, 'totalResults'),
      success: true,
    },
  }
}

export function createEloquaApplicationListTool<TResource extends EloquaApplicationResource>(
  options: ApplicationListToolOptions<TResource>
): ToolConfig<
  EloquaApplicationListParams,
  EloquaResponse<EloquaApplicationListOutput<EloquaApplicationResourceMap[TResource]>>
> {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    version: '1.0.0',
    oauth: ELOQUA_OAUTH_CONFIG,
    params: { ...ELOQUA_AUTH_PARAMS, ...ELOQUA_APPLICATION_LIST_PARAMS, ...options.extraParams },
    request: {
      url: (params) =>
        buildEloquaUrl(params, options.path, {
          ...applicationQuery(params),
          ...options.query?.(params),
        }),
      method: 'GET',
      headers: eloquaHeaders,
      stripAuthOnRedirect: true,
    },
    transformResponse: (response, params) =>
      transformApplicationList<EloquaApplicationResourceMap[TResource]>(
        response,
        params,
        options.name,
        options.allowNoContent ?? false
      ),
    outputs: eloquaApplicationListOutputs(options.resource),
  }
}

export function createEloquaApplicationItemTool<TResource extends EloquaApplicationResource>(
  options: ApplicationItemToolOptions<TResource>
): ToolConfig<
  EloquaIdParams,
  EloquaResponse<EloquaApplicationItemOutput<EloquaApplicationResourceMap[TResource]>>
> {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    version: '1.0.0',
    oauth: ELOQUA_OAUTH_CONFIG,
    params: {
      ...ELOQUA_AUTH_PARAMS,
      ...ELOQUA_ID_PARAM,
      depth: ELOQUA_APPLICATION_LIST_PARAMS.depth,
      ...options.extraParams,
    },
    request: {
      url: (params) =>
        buildEloquaUrl(params, options.path(eloquaResourceId(params.id)), {
          depth: params.depth,
          ...options.query?.(params),
        }),
      method: 'GET',
      headers: eloquaHeaders,
      stripAuthOnRedirect: true,
    },
    transformResponse: (response) =>
      transformApplicationItem<EloquaApplicationResourceMap[TResource]>(
        response,
        200,
        options.name
      ),
    outputs: eloquaApplicationItemOutputs(options.resource),
  }
}

export function createEloquaApplicationMutationTool<TResource extends 'contact' | 'account'>(
  options: ApplicationMutationToolOptions<TResource>
): ToolConfig<
  EloquaEntityBodyParams<EloquaApplicationResourceMap[TResource]>,
  EloquaResponse<EloquaApplicationItemOutput<EloquaApplicationResourceMap[TResource]>>
> {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    version: '1.0.0',
    oauth: ELOQUA_OAUTH_CONFIG,
    params: {
      ...ELOQUA_AUTH_PARAMS,
      ...(options.requiresId ? ELOQUA_ID_PARAM : {}),
      entity: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description: options.bodyDescription,
      },
    },
    request: {
      url: (params) =>
        buildEloquaUrl(
          params,
          options.path(options.requiresId ? eloquaResourceId(params.id) : undefined)
        ),
      method: options.method,
      headers: eloquaHeaders,
      body: (params) => requireEloquaObject(params.entity, 'entity'),
      stripAuthOnRedirect: true,
    },
    transformResponse: (response) =>
      transformApplicationItem<EloquaApplicationResourceMap[TResource]>(
        response,
        options.successStatus,
        options.name
      ),
    outputs: eloquaApplicationItemOutputs(options.resource),
  }
}

export function createEloquaCampaignActionTool(
  options: Omit<ApplicationItemToolOptions<'campaign'>, 'extraParams' | 'query' | 'resource'> & {
    action: 'activate' | 'deactivate'
  }
): ToolConfig<
  EloquaCampaignActionParams,
  EloquaResponse<EloquaApplicationItemOutput<EloquaApplicationResourceMap['campaign']>>
> {
  const isActivate = options.action === 'activate'
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    version: '1.0.0',
    oauth: ELOQUA_OAUTH_CONFIG,
    params: {
      ...ELOQUA_AUTH_PARAMS,
      ...ELOQUA_ID_PARAM,
      ...(isActivate
        ? {
            scheduledFor: {
              type: 'string',
              required: false,
              visibility: 'user-or-llm',
              description: 'Unix timestamp or literal "now" at which to activate the campaign',
            },
            runAsUserId: {
              type: 'number',
              required: false,
              visibility: 'user-or-llm',
              description: 'Eloqua user ID under which the campaign should run',
            },
            activateNow: {
              type: 'boolean',
              required: false,
              visibility: 'user-or-llm',
              description: 'Activate immediately instead of waiting for scheduledFor',
            },
          }
        : {}),
    },
    request: {
      url: (params) =>
        buildEloquaUrl(params, options.path(eloquaResourceId(params.id)), {
          ...(isActivate && params.scheduledFor !== undefined
            ? { scheduledFor: eloquaCampaignSchedule(params.scheduledFor) }
            : {}),
          runAsUserId: isActivate
            ? eloquaPositiveInteger(params.runAsUserId, 'Eloqua run-as user ID')
            : undefined,
          activateNow: isActivate ? params.activateNow : undefined,
        }),
      method: 'POST',
      headers: eloquaHeaders,
      stripAuthOnRedirect: true,
    },
    transformResponse: (response) =>
      transformApplicationItem<EloquaApplicationResourceMap['campaign']>(
        response,
        201,
        options.name
      ),
    outputs: eloquaApplicationItemOutputs('campaign'),
  }
}

export function createEloquaBulkListTool<TItemKind extends 'contactField' | 'sync'>(
  options: BulkListToolOptions<TItemKind>
): ToolConfig<
  EloquaBulkPageParams,
  EloquaResponse<EloquaBulkPageOutput<EloquaBulkItemMap[TItemKind]>>
> {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    version: '1.0.0',
    oauth: ELOQUA_OAUTH_CONFIG,
    params: { ...ELOQUA_AUTH_PARAMS, ...bulkPageToolParams(1_000, true) },
    request: {
      url: (params) => buildEloquaUrl(params, options.path, bulkQuery(params, 1_000)),
      method: 'GET',
      headers: eloquaHeaders,
      stripAuthOnRedirect: true,
    },
    transformResponse: (response) =>
      transformBulkPage<EloquaBulkItemMap[TItemKind]>(response, options.name),
    outputs: eloquaBulkListOutputs(options.itemKind),
  }
}

export function createEloquaBulkDefinitionTool<TKind extends EloquaBulkDefinitionKind>(
  options: BulkDefinitionToolOptions<TKind>
): ToolConfig<
  EloquaBulkDefinitionParams<EloquaBulkDefinitionMap[TKind]>,
  EloquaResponse<EloquaBulkDefinitionOutput<EloquaBulkDefinitionMap[TKind]>>
> {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    version: '1.0.0',
    oauth: ELOQUA_OAUTH_CONFIG,
    params: {
      ...ELOQUA_AUTH_PARAMS,
      definition: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description: 'Documented Eloqua Bulk definition, including dynamic fields aliases',
      },
    },
    request: {
      url: (params) => buildEloquaUrl(params, options.path),
      method: 'POST',
      headers: eloquaHeaders,
      body: (params) => validateEloquaBulkDefinition(params.definition, options.definitionKind),
      stripAuthOnRedirect: true,
    },
    transformResponse: async (response) => {
      assertStatus(response, [201], options.name)
      const definition = await eloquaJsonObject(response, options.name)
      return {
        success: true,
        output: { definition: definition as EloquaBulkDefinitionMap[TKind], success: true },
      }
    },
    outputs: eloquaBulkDefinitionOutputs(options.definitionKind),
  }
}

export function createEloquaBulkSyncPageTool<
  TItemKind extends 'syncData' | 'syncLog' | 'syncReject',
>(
  options: BulkSyncPageToolOptions<TItemKind>
): ToolConfig<
  EloquaBulkSyncPageParams,
  EloquaResponse<EloquaBulkPageOutput<EloquaBulkItemMap[TItemKind]>>
> {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    version: '1.0.0',
    oauth: ELOQUA_OAUTH_CONFIG,
    params: {
      ...ELOQUA_AUTH_PARAMS,
      ...ELOQUA_ID_PARAM,
      ...bulkPageToolParams(options.maxLimit, options.includeSearch ?? false),
    },
    request: {
      url: (params) =>
        buildEloquaUrl(
          params,
          `/api/bulk/2.0/syncs/${eloquaResourceId(params.id)}${options.suffix}`,
          options.includeSearch
            ? bulkQuery(params, options.maxLimit)
            : (() => {
                validateBulkPagination(params.limit, params.offset, options.maxLimit)
                return {
                  limit: params.limit,
                  offset: params.offset,
                  totalResults: params.totalResults,
                }
              })()
        ),
      method: 'GET',
      headers: eloquaHeaders,
      stripAuthOnRedirect: true,
    },
    transformResponse: (response) =>
      transformBulkPage<EloquaBulkItemMap[TItemKind]>(response, options.name),
    outputs: eloquaBulkListOutputs(options.itemKind),
  }
}

export function createEloquaGetBulkSyncTool(): ToolConfig<
  EloquaBulkSyncParams,
  EloquaResponse<EloquaSyncOutput>
> {
  return {
    id: 'eloqua_get_bulk_sync',
    name: 'Get Oracle Eloqua Bulk Sync',
    description: 'Retrieve the current status and timestamps of one Bulk API synchronization.',
    version: '1.0.0',
    oauth: ELOQUA_OAUTH_CONFIG,
    params: { ...ELOQUA_AUTH_PARAMS, ...ELOQUA_ID_PARAM },
    request: {
      url: (params) => buildEloquaUrl(params, `/api/bulk/2.0/syncs/${eloquaResourceId(params.id)}`),
      method: 'GET',
      headers: eloquaHeaders,
      stripAuthOnRedirect: true,
    },
    transformResponse: async (response) => {
      assertStatus(response, [200], 'Get Oracle Eloqua Bulk Sync')
      const sync = validateEloquaSync(
        await eloquaJsonObject(response, 'Get Oracle Eloqua Bulk Sync'),
        'Eloqua Bulk sync response'
      )
      return { success: true, output: { sync, success: true } }
    },
    outputs: ELOQUA_BULK_SYNC_OUTPUTS,
  }
}

export function createEloquaStartBulkSyncTool(): ToolConfig<
  EloquaStartSyncParams,
  EloquaResponse<EloquaSyncOutput>
> {
  return {
    id: 'eloqua_start_bulk_sync',
    name: 'Start Oracle Eloqua Bulk Sync',
    description: 'Start a Bulk API synchronization for an existing contact import or export.',
    version: '1.0.0',
    oauth: ELOQUA_OAUTH_CONFIG,
    params: {
      ...ELOQUA_AUTH_PARAMS,
      syncedInstanceUri: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'URI returned by a contact import or export definition',
      },
      callbackUrl: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'HTTPS callback URL Eloqua should notify when the sync completes',
      },
    },
    request: {
      url: (params) => buildEloquaUrl(params, '/api/bulk/2.0/syncs'),
      method: 'POST',
      headers: eloquaHeaders,
      body: (params) => ({
        syncedInstanceUri: eloquaResourceUri(params.syncedInstanceUri),
        ...(params.callbackUrl ? { callbackUrl: eloquaCallbackUrl(params.callbackUrl) } : {}),
      }),
      stripAuthOnRedirect: true,
    },
    transformResponse: async (response) => {
      assertStatus(response, [201], 'Start Oracle Eloqua Bulk Sync')
      const sync = validateEloquaSync(
        await eloquaJsonObject(response, 'Start Oracle Eloqua Bulk Sync'),
        'Eloqua Bulk sync response'
      )
      return { success: true, output: { sync, success: true } }
    },
    outputs: ELOQUA_BULK_SYNC_OUTPUTS,
  }
}

export function createEloquaUploadContactImportDataTool(): ToolConfig<
  EloquaBulkImportDataParams,
  EloquaResponse<EloquaBulkUploadOutput>
> {
  return {
    id: 'eloqua_upload_contact_import_data',
    name: 'Upload Oracle Eloqua Contact Import Data',
    description:
      "Stage one bounded JSON batch for a contact import definition. The serialized body must stay within Sim's 10 MiB request limit.",
    version: '1.0.0',
    oauth: ELOQUA_OAUTH_CONFIG,
    params: {
      ...ELOQUA_AUTH_PARAMS,
      ...ELOQUA_ID_PARAM,
      data: {
        type: 'array',
        required: true,
        visibility: 'user-or-llm',
        description: 'Array of records keyed by aliases from the import definition',
        items: { type: 'object', additionalProperties: true },
      },
    },
    request: {
      url: (params) =>
        buildEloquaUrl(
          params,
          `/api/bulk/2.0/contacts/imports/${eloquaResourceId(params.id)}/data`
        ),
      method: 'POST',
      headers: eloquaHeaders,
      body: (params) => JSON.stringify(validateInlineImportData(params.data)),
      stripAuthOnRedirect: true,
    },
    transformResponse: async (response) => {
      assertStatus(response, [201, 204], 'Upload Oracle Eloqua Contact Import Data')
      if (response.status === 204) {
        return { success: true, output: { accepted: true, sync: null, success: true } }
      }
      const sync = validateEloquaSync(
        await eloquaJsonObject(response, 'Upload Oracle Eloqua Contact Import Data'),
        'Eloqua Bulk sync response'
      )
      return { success: true, output: { accepted: true, sync, success: true } }
    },
    outputs: ELOQUA_BULK_UPLOAD_OUTPUTS,
  }
}
