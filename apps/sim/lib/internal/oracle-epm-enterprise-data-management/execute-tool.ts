import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import { getValidationErrorMessage } from '@/lib/api/server'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  createOracleEpmClient,
  normalizeOracleEpmDestination,
  OracleEpmError,
} from '@/lib/internal/oracle-epm'
import { EDM_JSON_BYTES } from '@/lib/internal/oracle-epm-enterprise-data-management/endpoints'
import {
  assignEdmRequest,
  browseEdmNodes,
  createEdmRequest,
  deleteEdmRequest,
  exportEdmDimension,
  exportEdmMappings,
  extractEdmDimensionViewpoint,
  generateEdmRequestAttachment,
  getEdmJobResult,
  getEdmJobStatus,
  getEdmMappingKeys,
  getEdmNode,
  getEdmNodeType,
  getEdmRequest,
  getEdmRequestLineage,
  importEdmDimension,
  importEdmRequestAttachment,
  incrementalExportEdmDimension,
  listEdmApplications,
  listEdmDimensions,
  listEdmNodes,
  listEdmNodeTypes,
  listEdmViewpoints,
  listEdmViews,
  loadEdmViewpoint,
  queryEdmRequests,
  transitionEdmRequest,
  uploadEdmRequestAttachment,
  validateEdmViewpoint,
} from '@/lib/internal/oracle-epm-enterprise-data-management/operations'
import { edmInputSchemas } from '@/lib/internal/oracle-epm-enterprise-data-management/schemas'
import {
  type EdmAction,
  type EdmInput,
  type EdmOperationContext,
  EdmOperationError,
} from '@/lib/internal/oracle-epm-enterprise-data-management/types'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

const logger = createLogger('OracleEpmEdm')

export async function executeEdmOperation(input: EdmInput, context: EdmOperationContext) {
  switch (input.operation) {
    case 'oracle_epm_edm_list_applications':
      return listEdmApplications(input, context)
    case 'oracle_epm_edm_list_dimensions':
      return listEdmDimensions(input, context)
    case 'oracle_epm_edm_list_views':
      return listEdmViews(input, context)
    case 'oracle_epm_edm_list_viewpoints':
      return listEdmViewpoints(input, context)
    case 'oracle_epm_edm_list_node_types':
      return listEdmNodeTypes(input, context)
    case 'oracle_epm_edm_get_node_type':
      return getEdmNodeType(input, context)
    case 'oracle_epm_edm_list_nodes':
      return listEdmNodes(input, context)
    case 'oracle_epm_edm_get_node':
      return getEdmNode(input, context)
    case 'oracle_epm_edm_get_node_at_location':
      return getEdmNode(input, context)
    case 'oracle_epm_edm_browse_hierarchy':
      return browseEdmNodes(input, context)
    case 'oracle_epm_edm_create_request':
      return createEdmRequest(input, context)
    case 'oracle_epm_edm_get_request':
      return getEdmRequest(input, context)
    case 'oracle_epm_edm_query_requests':
      return queryEdmRequests(input, context)
    case 'oracle_epm_edm_get_request_lineage':
      return getEdmRequestLineage(input, context)
    case 'oracle_epm_edm_assign_request':
      return assignEdmRequest(input, context)
    case 'oracle_epm_edm_delete_request':
      return deleteEdmRequest(input, context)
    case 'oracle_epm_edm_upload_request_attachment':
      return uploadEdmRequestAttachment(input, context)
    case 'oracle_epm_edm_generate_request_attachment':
      return generateEdmRequestAttachment(input, context)
    case 'oracle_epm_edm_import_request_attachment':
      return importEdmRequestAttachment(input, context)
    case 'oracle_epm_edm_transition_request':
      return transitionEdmRequest(input, context)
    case 'oracle_epm_edm_get_job_status':
      return getEdmJobStatus(input, context)
    case 'oracle_epm_edm_get_job_result':
      return getEdmJobResult(input, context)
    case 'oracle_epm_edm_validate_viewpoint':
      return validateEdmViewpoint(input, context)
    case 'oracle_epm_edm_get_mapping_keys':
      return getEdmMappingKeys(input, context)
    case 'oracle_epm_edm_export_mappings':
      return exportEdmMappings(input, context)
    case 'oracle_epm_edm_import_dimension':
      return importEdmDimension(input, context)
    case 'oracle_epm_edm_load_viewpoint':
      return loadEdmViewpoint(input, context)
    case 'oracle_epm_edm_export_dimension':
      return exportEdmDimension(input, context)
    case 'oracle_epm_edm_incremental_export_dimension':
      return incrementalExportEdmDimension(input, context)
    case 'oracle_epm_edm_extract_dimension_viewpoint':
      return extractEdmDimensionViewpoint(input, context)
  }
}

export const executeOracleEpmEdmTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  const action = request.toolId.slice('oracle_epm_edm_'.length)
  if (!request.toolId.startsWith('oracle_epm_edm_') || !Object.hasOwn(edmInputSchemas, action)) {
    return Response.json(
      { success: false, retryable: false, error: 'Unsupported Oracle EDM operation' },
      { status: 400 }
    )
  }
  if (!isRecordLike(request.input) || request.input.operation !== request.toolId) {
    return Response.json(
      {
        success: false,
        retryable: false,
        error: 'EDM input operation must match the executing tool',
      },
      { status: 400 }
    )
  }
  try {
    if (Buffer.byteLength(JSON.stringify(request.input), 'utf8') > EDM_JSON_BYTES) {
      return Response.json(
        { success: false, retryable: false, error: 'EDM operation input exceeds 10 MiB' },
        { status: 413 }
      )
    }
  } catch {
    return Response.json(
      { success: false, retryable: false, error: 'Invalid EDM operation input' },
      { status: 400 }
    )
  }
  const parsed = edmInputSchemas[action as EdmAction].safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      {
        success: false,
        retryable: false,
        error: getValidationErrorMessage(parsed.error, 'Invalid EDM input'),
      },
      { status: 400 }
    )
  }
  try {
    const input = parsed.data
    const instanceUrl = normalizeOracleEpmDestination(input.instanceUrl)
    const context: EdmOperationContext = {
      client: createOracleEpmClient({ instanceUrl, accessToken: input.accessToken }),
      instanceUrl,
      signal: request.signal,
      execution: request.context,
    }
    const output = await executeEdmOperation(input, context)
    request.signal?.throwIfAborted()
    const failed = 'job' in output && output.job?.status === 'ERROR'
    return Response.json({
      success: !failed,
      output,
      ...(failed
        ? { retryable: false, error: 'Oracle EDM job failed; inspect the returned job' }
        : {}),
    })
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof EdmOperationError) {
      return Response.json(
        { success: false, retryable: false, error: error.message, output: error.output },
        // Keep accepted-job failures on the structured ToolResponse path so the job ID survives.
        { status: error.output ? 200 : error.status }
      )
    }
    if (error instanceof OracleEpmError) {
      return Response.json(
        { success: false, retryable: false, error: error.message },
        { status: error.status ?? 502 }
      )
    }
    if (isPayloadSizeLimitError(error)) {
      return Response.json(
        { success: false, retryable: false, error: 'EDM payload exceeded the allowed size' },
        { status: 413 }
      )
    }
    logger.warn('EDM operation failed', { action, requestId: request.requestId })
    return Response.json(
      {
        success: false,
        retryable: false,
        error: 'Oracle EDM operation failed or returned an unsupported response',
      },
      { status: 502 }
    )
  }
}
