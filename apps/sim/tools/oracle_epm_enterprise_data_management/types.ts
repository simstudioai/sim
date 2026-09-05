import type { executeEdmOperation } from '@/lib/internal/oracle-epm-enterprise-data-management/execute-tool'
import type * as operations from '@/lib/internal/oracle-epm-enterprise-data-management/operations'
import type { EdmInputParams } from '@/lib/internal/oracle-epm-enterprise-data-management/types'
import type { ToolResponse } from '@/tools/types'

interface EdmAuthParams {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleEpmEdmResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof executeEdmOperation>>
}
export type OracleEpmEdmListApplicationsParams = Omit<
  EdmInputParams<'list_applications'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmListApplicationsResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.listEdmApplications>>
}

export type OracleEpmEdmListDimensionsParams = Omit<
  EdmInputParams<'list_dimensions'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmListDimensionsResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.listEdmDimensions>>
}

export type OracleEpmEdmListViewsParams = Omit<
  EdmInputParams<'list_views'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmListViewsResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.listEdmViews>>
}

export type OracleEpmEdmListViewpointsParams = Omit<
  EdmInputParams<'list_viewpoints'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmListViewpointsResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.listEdmViewpoints>>
}

export type OracleEpmEdmListNodeTypesParams = Omit<
  EdmInputParams<'list_node_types'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmListNodeTypesResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.listEdmNodeTypes>>
}

export type OracleEpmEdmGetNodeTypeParams = Omit<
  EdmInputParams<'get_node_type'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmGetNodeTypeResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.getEdmNodeType>>
}

export type OracleEpmEdmListNodesParams = Omit<
  EdmInputParams<'list_nodes'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmListNodesResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.listEdmNodes>>
}

export type OracleEpmEdmGetNodeParams = Omit<
  EdmInputParams<'get_node'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmGetNodeResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.getEdmNode>>
}

export type OracleEpmEdmGetNodeAtLocationParams = Omit<
  EdmInputParams<'get_node_at_location'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmGetNodeAtLocationResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.getEdmNode>>
}

export type OracleEpmEdmBrowseHierarchyParams = Omit<
  EdmInputParams<'browse_hierarchy'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmBrowseHierarchyResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.browseEdmNodes>>
}

export type OracleEpmEdmCreateRequestParams = Omit<
  EdmInputParams<'create_request'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmCreateRequestResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.createEdmRequest>>
}

export type OracleEpmEdmGetRequestParams = Omit<
  EdmInputParams<'get_request'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmGetRequestResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.getEdmRequest>>
}

export type OracleEpmEdmQueryRequestsParams = Omit<
  EdmInputParams<'query_requests'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmQueryRequestsResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.queryEdmRequests>>
}

export type OracleEpmEdmGetRequestLineageParams = Omit<
  EdmInputParams<'get_request_lineage'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmGetRequestLineageResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.getEdmRequestLineage>>
}

export type OracleEpmEdmAssignRequestParams = Omit<
  EdmInputParams<'assign_request'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmAssignRequestResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.assignEdmRequest>>
}

export type OracleEpmEdmDeleteRequestParams = Omit<
  EdmInputParams<'delete_request'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmDeleteRequestResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.deleteEdmRequest>>
}

export type OracleEpmEdmUploadRequestAttachmentParams = Omit<
  EdmInputParams<'upload_request_attachment'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmUploadRequestAttachmentResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.uploadEdmRequestAttachment>>
}

export type OracleEpmEdmGenerateRequestAttachmentParams = Omit<
  EdmInputParams<'generate_request_attachment'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmGenerateRequestAttachmentResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.generateEdmRequestAttachment>>
}

export type OracleEpmEdmImportRequestAttachmentParams = Omit<
  EdmInputParams<'import_request_attachment'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmImportRequestAttachmentResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.importEdmRequestAttachment>>
}

export type OracleEpmEdmTransitionRequestParams = Omit<
  EdmInputParams<'transition_request'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmTransitionRequestResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.transitionEdmRequest>>
}

export type OracleEpmEdmGetJobStatusParams = Omit<
  EdmInputParams<'get_job_status'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmGetJobStatusResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.getEdmJobStatus>>
}

export type OracleEpmEdmGetJobResultParams = Omit<
  EdmInputParams<'get_job_result'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmGetJobResultResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.getEdmJobResult>>
}

export type OracleEpmEdmValidateViewpointParams = Omit<
  EdmInputParams<'validate_viewpoint'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmValidateViewpointResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.validateEdmViewpoint>>
}

export type OracleEpmEdmGetMappingKeysParams = Omit<
  EdmInputParams<'get_mapping_keys'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmGetMappingKeysResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.getEdmMappingKeys>>
}

export type OracleEpmEdmExportMappingsParams = Omit<
  EdmInputParams<'export_mappings'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmExportMappingsResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.exportEdmMappings>>
}

export type OracleEpmEdmImportDimensionParams = Omit<
  EdmInputParams<'import_dimension'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmImportDimensionResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.importEdmDimension>>
}

export type OracleEpmEdmLoadViewpointParams = Omit<
  EdmInputParams<'load_viewpoint'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmLoadViewpointResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.loadEdmViewpoint>>
}

export type OracleEpmEdmExportDimensionParams = Omit<
  EdmInputParams<'export_dimension'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmExportDimensionResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.exportEdmDimension>>
}

export type OracleEpmEdmIncrementalExportDimensionParams = Omit<
  EdmInputParams<'incremental_export_dimension'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmIncrementalExportDimensionResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.incrementalExportEdmDimension>>
}

export type OracleEpmEdmExtractDimensionViewpointParams = Omit<
  EdmInputParams<'extract_dimension_viewpoint'>,
  'operation' | 'accessToken' | 'instanceUrl'
> &
  EdmAuthParams
export interface OracleEpmEdmExtractDimensionViewpointResponse extends ToolResponse {
  output: Awaited<ReturnType<typeof operations.extractEdmDimensionViewpoint>>
}
