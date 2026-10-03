import type {
  AwsSsmCancelCommandRequest,
  AwsSsmCancelCommandResponse,
} from '@/lib/api/contracts/tools/aws/ssm-cancel-command'
import type {
  AwsSsmDeleteParameterRequest,
  AwsSsmDeleteParameterResponse,
} from '@/lib/api/contracts/tools/aws/ssm-delete-parameter'
import type {
  AwsSsmDescribeAutomationExecutionsRequest,
  AwsSsmDescribeAutomationExecutionsResponse,
} from '@/lib/api/contracts/tools/aws/ssm-describe-automation-executions'
import type {
  AwsSsmDescribeInstanceInformationRequest,
  AwsSsmDescribeInstanceInformationResponse,
} from '@/lib/api/contracts/tools/aws/ssm-describe-instance-information'
import type {
  AwsSsmDescribeInstancePatchStatesRequest,
  AwsSsmDescribeInstancePatchStatesResponse,
} from '@/lib/api/contracts/tools/aws/ssm-describe-instance-patch-states'
import type {
  AwsSsmDescribeInstancePatchesRequest,
  AwsSsmDescribeInstancePatchesResponse,
} from '@/lib/api/contracts/tools/aws/ssm-describe-instance-patches'
import type {
  AwsSsmDescribeParametersRequest,
  AwsSsmDescribeParametersResponse,
} from '@/lib/api/contracts/tools/aws/ssm-describe-parameters'
import type {
  AwsSsmGetAutomationExecutionRequest,
  AwsSsmGetAutomationExecutionResponse,
} from '@/lib/api/contracts/tools/aws/ssm-get-automation-execution'
import type {
  AwsSsmGetCommandInvocationRequest,
  AwsSsmGetCommandInvocationResponse,
} from '@/lib/api/contracts/tools/aws/ssm-get-command-invocation'
import type {
  AwsSsmGetDocumentRequest,
  AwsSsmGetDocumentResponse,
} from '@/lib/api/contracts/tools/aws/ssm-get-document'
import type {
  AwsSsmGetParameterRequest,
  AwsSsmGetParameterResponse,
} from '@/lib/api/contracts/tools/aws/ssm-get-parameter'
import type {
  AwsSsmGetParametersRequest,
  AwsSsmGetParametersResponse,
} from '@/lib/api/contracts/tools/aws/ssm-get-parameters'
import type {
  AwsSsmGetParametersByPathRequest,
  AwsSsmGetParametersByPathResponse,
} from '@/lib/api/contracts/tools/aws/ssm-get-parameters-by-path'
import type {
  AwsSsmListCommandInvocationsRequest,
  AwsSsmListCommandInvocationsResponse,
} from '@/lib/api/contracts/tools/aws/ssm-list-command-invocations'
import type {
  AwsSsmListCommandsRequest,
  AwsSsmListCommandsResponse,
} from '@/lib/api/contracts/tools/aws/ssm-list-commands'
import type {
  AwsSsmListComplianceItemsRequest,
  AwsSsmListComplianceItemsResponse,
} from '@/lib/api/contracts/tools/aws/ssm-list-compliance-items'
import type {
  AwsSsmListComplianceSummariesRequest,
  AwsSsmListComplianceSummariesResponse,
} from '@/lib/api/contracts/tools/aws/ssm-list-compliance-summaries'
import type {
  AwsSsmListDocumentsRequest,
  AwsSsmListDocumentsResponse,
} from '@/lib/api/contracts/tools/aws/ssm-list-documents'
import type {
  AwsSsmPutParameterRequest,
  AwsSsmPutParameterResponse,
} from '@/lib/api/contracts/tools/aws/ssm-put-parameter'
import type {
  AwsSsmSendCommandRequest,
  AwsSsmSendCommandResponse,
} from '@/lib/api/contracts/tools/aws/ssm-send-command'
import type {
  AwsSsmStartAutomationExecutionRequest,
  AwsSsmStartAutomationExecutionResponse,
} from '@/lib/api/contracts/tools/aws/ssm-start-automation-execution'
import type {
  AwsSsmStopAutomationExecutionRequest,
  AwsSsmStopAutomationExecutionResponse,
} from '@/lib/api/contracts/tools/aws/ssm-stop-automation-execution'
import type { ToolResponse } from '@/tools/types'

export type SsmSendCommandParams = AwsSsmSendCommandRequest

export interface SsmSendCommandResponse extends ToolResponse {
  output: AwsSsmSendCommandResponse
}

export type SsmListCommandsParams = AwsSsmListCommandsRequest

export interface SsmListCommandsResponse extends ToolResponse {
  output: AwsSsmListCommandsResponse
}

export type SsmListCommandInvocationsParams = AwsSsmListCommandInvocationsRequest

export interface SsmListCommandInvocationsResponse extends ToolResponse {
  output: AwsSsmListCommandInvocationsResponse
}

export type SsmGetCommandInvocationParams = AwsSsmGetCommandInvocationRequest

export interface SsmGetCommandInvocationResponse extends ToolResponse {
  output: AwsSsmGetCommandInvocationResponse
}

export type SsmCancelCommandParams = AwsSsmCancelCommandRequest

export interface SsmCancelCommandResponse extends ToolResponse {
  output: AwsSsmCancelCommandResponse
}

export type SsmGetParameterParams = AwsSsmGetParameterRequest

export interface SsmGetParameterResponse extends ToolResponse {
  output: AwsSsmGetParameterResponse
}

export type SsmGetParametersParams = AwsSsmGetParametersRequest

export interface SsmGetParametersResponse extends ToolResponse {
  output: AwsSsmGetParametersResponse
}

export type SsmGetParametersByPathParams = AwsSsmGetParametersByPathRequest

export interface SsmGetParametersByPathResponse extends ToolResponse {
  output: AwsSsmGetParametersByPathResponse
}

export type SsmPutParameterParams = AwsSsmPutParameterRequest

export interface SsmPutParameterResponse extends ToolResponse {
  output: AwsSsmPutParameterResponse
}

export type SsmDeleteParameterParams = AwsSsmDeleteParameterRequest

export interface SsmDeleteParameterResponse extends ToolResponse {
  output: AwsSsmDeleteParameterResponse
}

export type SsmDescribeParametersParams = AwsSsmDescribeParametersRequest

export interface SsmDescribeParametersResponse extends ToolResponse {
  output: AwsSsmDescribeParametersResponse
}

export type SsmDescribeInstanceInformationParams = AwsSsmDescribeInstanceInformationRequest

export interface SsmDescribeInstanceInformationResponse extends ToolResponse {
  output: AwsSsmDescribeInstanceInformationResponse
}

export type SsmDescribeInstancePatchesParams = AwsSsmDescribeInstancePatchesRequest

export interface SsmDescribeInstancePatchesResponse extends ToolResponse {
  output: AwsSsmDescribeInstancePatchesResponse
}

export type SsmDescribeInstancePatchStatesParams = AwsSsmDescribeInstancePatchStatesRequest

export interface SsmDescribeInstancePatchStatesResponse extends ToolResponse {
  output: AwsSsmDescribeInstancePatchStatesResponse
}

export type SsmListComplianceItemsParams = AwsSsmListComplianceItemsRequest

export interface SsmListComplianceItemsResponse extends ToolResponse {
  output: AwsSsmListComplianceItemsResponse
}

export type SsmListComplianceSummariesParams = AwsSsmListComplianceSummariesRequest

export interface SsmListComplianceSummariesResponse extends ToolResponse {
  output: AwsSsmListComplianceSummariesResponse
}

export type SsmStartAutomationExecutionParams = AwsSsmStartAutomationExecutionRequest

export interface SsmStartAutomationExecutionResponse extends ToolResponse {
  output: AwsSsmStartAutomationExecutionResponse
}

export type SsmDescribeAutomationExecutionsParams = AwsSsmDescribeAutomationExecutionsRequest

export interface SsmDescribeAutomationExecutionsResponse extends ToolResponse {
  output: AwsSsmDescribeAutomationExecutionsResponse
}

export type SsmGetAutomationExecutionParams = AwsSsmGetAutomationExecutionRequest

export interface SsmGetAutomationExecutionResponse extends ToolResponse {
  output: AwsSsmGetAutomationExecutionResponse
}

export type SsmStopAutomationExecutionParams = AwsSsmStopAutomationExecutionRequest

export interface SsmStopAutomationExecutionResponse extends ToolResponse {
  output: AwsSsmStopAutomationExecutionResponse
}

export type SsmListDocumentsParams = AwsSsmListDocumentsRequest

export interface SsmListDocumentsResponse extends ToolResponse {
  output: AwsSsmListDocumentsResponse
}

export type SsmGetDocumentParams = AwsSsmGetDocumentRequest

export interface SsmGetDocumentResponse extends ToolResponse {
  output: AwsSsmGetDocumentResponse
}
