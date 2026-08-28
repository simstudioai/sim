import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { getValidationErrorMessage } from '@/lib/api/server'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { AzureDataExplorerOperationError } from '@/lib/internal/azure-data-explorer/client'
import { executeAzureDataExplorerOperation } from '@/lib/internal/azure-data-explorer/operations'
import { azureDataExplorerInputSchema } from '@/lib/internal/azure-data-explorer/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

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

  const parsed = azureDataExplorerInputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      {
        success: false,
        error: getValidationErrorMessage(parsed.error, 'Validation failed'),
      },
      { status: 400 }
    )
  }

  try {
    const output = await executeAzureDataExplorerOperation(
      parsed.data,
      request.requestId,
      request.signal
    )
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
