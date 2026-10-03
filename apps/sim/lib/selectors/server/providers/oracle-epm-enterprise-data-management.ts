import { ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/client-credential-accounts/descriptors'
import {
  createOracleEpmClient,
  normalizeOracleEpmDestination,
  OracleEpmError,
} from '@/lib/internal/oracle-epm'
import {
  listEdmApplications,
  listEdmDimensions,
  listEdmNodeTypes,
  listEdmViewpoints,
  listEdmViews,
  queryEdmRequests,
} from '@/lib/internal/oracle-epm-enterprise-data-management/operations'
import { edmInputSchemas } from '@/lib/internal/oracle-epm-enterprise-data-management/schemas'
import type { EdmOperationContext } from '@/lib/internal/oracle-epm-enterprise-data-management/types'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import { flatSelectorResult } from '@/lib/selectors/server/providers/flat-results'
import {
  definePreparedSelectorAttachment,
  type ExecuteServerSelectorArgs,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'

type EdmSelectorKey = Extract<ServerSelectorKey, `oracleEpmEdm.${string}`>
interface PreparedEdmSelector {
  auth: { oauthCredential: string; accessToken: string; instanceUrl: string }
  context: EdmOperationContext
}
const MAX_OPTIONS = 500

async function prepareEdmSelector(args: ExecuteServerSelectorArgs): Promise<PreparedEdmSelector> {
  const credential = args.credential
  const access = credential?.access
  if (
    !credential ||
    access?.credentialType !== 'service_account' ||
    !access.resolvedCredentialId ||
    credential.providerId !== ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID
  ) {
    throw new SelectorConnectionUnavailableError()
  }
  const token = await resolveSelectorCredentialBundle({
    credential,
    protectedValues: args.protectedValues,
    recordCredentialUse: args.recordCredentialUse,
    providerId: ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID,
  })
  if (!token.instanceUrl) throw new SelectorConnectionUnavailableError()
  let instanceUrl: string
  try {
    instanceUrl = normalizeOracleEpmDestination(token.instanceUrl)
  } catch {
    throw new SelectorConnectionUnavailableError()
  }
  const auth = {
    oauthCredential: access.resolvedCredentialId,
    accessToken: token.accessToken,
    instanceUrl,
  }
  return {
    auth,
    context: {
      client: createOracleEpmClient(auth),
      instanceUrl,
      signal: args.signal,
      execution: {
        workflowId: args.scope.kind === 'workflow' ? args.scope.workflowId : '',
        workspaceId: args.workspaceId,
        userId: args.requesterUserId,
      },
    },
  }
}

/** Search here filters only the bounded discovery result; it is not Oracle node search. */
async function discoverEdmSelector(args: ExecuteServerSelectorArgs, prepared: PreparedEdmSelector) {
  args.signal?.throwIfAborted()
  const { auth, context } = prepared
  let options: SafeSelectorOption[]
  let truncated: boolean
  const base = { ...auth, maxResults: MAX_OPTIONS }
  const project = (items: { id: string; name?: string | null; description?: string | null }[]) =>
    items.map((item) => ({
      id: item.id,
      label: item.name || item.id,
      ...(item.description ? { meta: { description: item.description } } : {}),
    }))
  switch (args.selectorKey as EdmSelectorKey) {
    case 'oracleEpmEdm.applications': {
      const input = edmInputSchemas.list_applications.parse({
        ...base,
        operation: 'oracle_epm_edm_list_applications',
      })
      const result = (await listEdmApplications(input, context)).applications
      options = project(result.items)
      truncated = result.truncated
      break
    }
    case 'oracleEpmEdm.dimensions': {
      const input = edmInputSchemas.list_dimensions.safeParse({
        ...base,
        operation: 'oracle_epm_edm_list_dimensions',
        applicationId: args.context.applicationId,
      })
      if (!input.success) throw new SelectorContextUnavailableError()
      const result = (await listEdmDimensions(input.data, context)).dimensions
      options = project(result.items)
      truncated = result.truncated
      break
    }
    case 'oracleEpmEdm.views': {
      const input = edmInputSchemas.list_views.parse({
        ...base,
        operation: 'oracle_epm_edm_list_views',
      })
      const result = (await listEdmViews(input, context)).views
      options = project(result.items)
      truncated = result.truncated
      break
    }
    case 'oracleEpmEdm.viewpoints': {
      const input = edmInputSchemas.list_viewpoints.safeParse({
        ...base,
        operation: 'oracle_epm_edm_list_viewpoints',
        viewId: args.context.viewId,
      })
      if (!input.success) throw new SelectorContextUnavailableError()
      const result = (await listEdmViewpoints(input.data, context)).viewpoints
      options = project(result.items)
      truncated = result.truncated
      break
    }
    case 'oracleEpmEdm.nodeTypes': {
      const input = edmInputSchemas.list_node_types.safeParse({
        ...base,
        operation: 'oracle_epm_edm_list_node_types',
        viewId: args.context.viewId,
        viewpointId: args.context.viewpointId,
      })
      if (!input.success) throw new SelectorContextUnavailableError()
      const result = (await listEdmNodeTypes(input.data, context)).nodeTypes
      options = project(result.items)
      truncated = result.truncated
      break
    }
    case 'oracleEpmEdm.requests': {
      const input = edmInputSchemas.query_requests.parse({
        ...base,
        operation: 'oracle_epm_edm_query_requests',
        lastDays: 30,
      })
      const result = (await queryEdmRequests(input, context)).requests
      options = result.items.map((item) => ({
        id: item.id,
        label:
          [item.requestNumber, item.title]
            .filter((value) => value !== null && value !== undefined && value !== '')
            .join(' — ') || item.id,
        meta: { status: item.status ?? null, requestNumber: item.requestNumber ?? null },
      }))
      truncated = result.truncated
      break
    }
  }
  const unique = [...new Map(options.map((item) => [item.id, item])).values()]
  const search =
    args.request.kind === 'list' ? args.request.search?.trim().toLowerCase() : undefined
  const filtered = search
    ? unique.filter((item) => item.label.toLowerCase().includes(search))
    : unique
  return flatSelectorResult(
    args.request,
    filtered,
    true,
    truncated ? { truncated: { reason: 'provider-cap', limit: MAX_OPTIONS } } : undefined
  )
}

async function executeEdmSelector(args: ExecuteServerSelectorArgs, prepared: PreparedEdmSelector) {
  try {
    return await discoverEdmSelector(args, prepared)
  } catch (error) {
    args.signal?.throwIfAborted()
    if (error instanceof SelectorContextUnavailableError) throw error
    if (error instanceof OracleEpmError) {
      if (error.status === 401 || error.status === 403)
        throw new SelectorConnectionUnavailableError(error.status)
      if (error.status === 429) throw new SelectorOptionsUnavailableError(429)
    }
    throw new SelectorOptionsUnavailableError()
  }
}

const attachment = {
  credential: {
    kind: 'stored',
    field: 'oauthCredential',
    serviceIds: ['oracle-epm-enterprise-data-management'],
  },
  integrationBlockTypes: ['oracle_epm_enterprise_data_management'],
  destination: { kind: 'credential-bound', prepare: prepareEdmSelector },
  execute: executeEdmSelector,
} as const

export const oracleEpmEdmSelectorAttachments = {
  'oracleEpmEdm.applications': definePreparedSelectorAttachment(attachment),
  'oracleEpmEdm.dimensions': definePreparedSelectorAttachment(attachment),
  'oracleEpmEdm.views': definePreparedSelectorAttachment(attachment),
  'oracleEpmEdm.viewpoints': definePreparedSelectorAttachment(attachment),
  'oracleEpmEdm.nodeTypes': definePreparedSelectorAttachment(attachment),
  'oracleEpmEdm.requests': definePreparedSelectorAttachment(attachment),
} satisfies ServerSelectorAttachmentMap<EdmSelectorKey>
