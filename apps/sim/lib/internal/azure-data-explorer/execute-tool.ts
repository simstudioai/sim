import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { getValidationErrorMessage } from '@/lib/api/server'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import {
  AzureDataExplorerOperationError,
  requestAzureDataExplorer,
  requestAzureDataExplorerAsApp,
} from '@/lib/internal/azure-data-explorer/client'
import {
  azureDataExplorerInputSchema,
  azureDataExplorerRequestSchema,
} from '@/lib/internal/azure-data-explorer/schema'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'
import type { AzureDataExplorerTable } from '@/tools/azure_data_explorer/types'
import { AZURE_DATA_EXPLORER_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'

const logger = createLogger('AzureDataExplorerToolExecution')

const TOOL_IDS = new Set([
  'azure_data_explorer_create_table',
  'azure_data_explorer_drop_table',
  'azure_data_explorer_ingest_from_query',
  'azure_data_explorer_ingest_inline',
  'azure_data_explorer_list_databases',
  'azure_data_explorer_list_functions',
  'azure_data_explorer_list_tables',
  'azure_data_explorer_management',
  'azure_data_explorer_query',
  'azure_data_explorer_show_database_schema',
  'azure_data_explorer_show_ingestion_failures',
  'azure_data_explorer_show_operations',
  'azure_data_explorer_show_table_details',
  'azure_data_explorer_show_table_schema',
])

function exceedsInputCap(input: unknown): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(input) ?? '') > DEFAULT_MAX_JSON_BODY_BYTES
  } catch {
    return true
  }
}

type PreparedOperation =
  | { ok: true; run: () => Promise<AzureDataExplorerTable> }
  | { ok: false; error: string }

/**
 * Parses the input for the identity the request runs as. The executor sets
 * `authorizedServiceAccountCredential` only after authorizing a saved Microsoft app credential,
 * never from tool input; with one, the request runs as that credential, re-checked against the
 * run's own workspace or organization, and any inline sign-in fields are dropped unread. Without one, the inline client secret is required, as always.
 */
function prepareOperation(request: InternalToolOperationCall): PreparedOperation {
  const authorized = request.context.authorizedServiceAccountCredential
  if (authorized?.service === AZURE_DATA_EXPLORER_CREDENTIAL_OAUTH.provider) {
    const parsed = azureDataExplorerRequestSchema.safeParse(request.input)
    if (!parsed.success) {
      return { ok: false, error: getValidationErrorMessage(parsed.error, 'Validation failed') }
    }
    return {
      ok: true,
      run: () =>
        requestAzureDataExplorerAsApp(
          parsed.data,
          {
            credentialId: authorized.credentialId,
            scope: {
              workspaceId: request.context.workspaceId,
              organizationId: request.context.organizationId,
            },
          },
          request.requestId,
          request.signal
        ),
    }
  }
  const parsed = azureDataExplorerInputSchema.safeParse(request.input)
  if (!parsed.success) {
    return { ok: false, error: getValidationErrorMessage(parsed.error, 'Validation failed') }
  }
  return {
    ok: true,
    run: () => requestAzureDataExplorer(parsed.data, request.requestId, request.signal),
  }
}

export const executeAzureDataExplorerTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!TOOL_IDS.has(request.toolId)) {
    return Response.json(
      { success: false, error: `Unsupported Azure Data Explorer tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  if (!request.context.userId) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }
  if (exceedsInputCap(request.input)) {
    return Response.json(
      {
        success: false,
        error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
      },
      { status: 413 }
    )
  }

  const prepared = prepareOperation(request)
  if (!prepared.ok) {
    return Response.json({ success: false, error: prepared.error }, { status: 400 })
  }

  try {
    const output = await prepared.run()
    request.signal?.throwIfAborted()
    return Response.json({ success: true, output })
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof AzureDataExplorerOperationError) {
      return Response.json(
        {
          success: false,
          error: error.message,
          ...(error.providerStatus === undefined ? {} : { status: error.providerStatus }),
        },
        { status: error.status }
      )
    }
    const message = getErrorMessage(error, 'Unknown error occurred')
    logger.error('Azure Data Explorer operation failed', {
      error: message,
      requestId: request.requestId,
    })
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
