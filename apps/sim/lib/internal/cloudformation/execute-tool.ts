import { getErrorMessage } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import { awsCloudformationCancelUpdateStackContract } from '@/lib/api/contracts/tools/aws/cloudformation-cancel-update-stack'
import { awsCloudformationCreateChangeSetContract } from '@/lib/api/contracts/tools/aws/cloudformation-create-change-set'
import { awsCloudformationCreateStackContract } from '@/lib/api/contracts/tools/aws/cloudformation-create-stack'
import { awsCloudformationDeleteStackContract } from '@/lib/api/contracts/tools/aws/cloudformation-delete-stack'
import { awsCloudformationDescribeChangeSetContract } from '@/lib/api/contracts/tools/aws/cloudformation-describe-change-set'
import { awsCloudformationDescribeStackDriftDetectionStatusContract } from '@/lib/api/contracts/tools/aws/cloudformation-describe-stack-drift-detection-status'
import { awsCloudformationDescribeStackEventsContract } from '@/lib/api/contracts/tools/aws/cloudformation-describe-stack-events'
import { awsCloudformationDescribeStacksContract } from '@/lib/api/contracts/tools/aws/cloudformation-describe-stacks'
import { awsCloudformationDetectStackDriftContract } from '@/lib/api/contracts/tools/aws/cloudformation-detect-stack-drift'
import { awsCloudformationExecuteChangeSetContract } from '@/lib/api/contracts/tools/aws/cloudformation-execute-change-set'
import { awsCloudformationGetTemplateContract } from '@/lib/api/contracts/tools/aws/cloudformation-get-template'
import { awsCloudformationGetTemplateSummaryContract } from '@/lib/api/contracts/tools/aws/cloudformation-get-template-summary'
import { awsCloudformationListStackResourcesContract } from '@/lib/api/contracts/tools/aws/cloudformation-list-stack-resources'
import { awsCloudformationUpdateStackContract } from '@/lib/api/contracts/tools/aws/cloudformation-update-stack'
import { awsCloudformationValidateTemplateContract } from '@/lib/api/contracts/tools/aws/cloudformation-validate-template'
import {
  executeCloudformationCancelUpdateStack,
  executeCloudformationCreateChangeSet,
  executeCloudformationCreateStack,
  executeCloudformationDeleteStack,
  executeCloudformationDescribeChangeSet,
  executeCloudformationDescribeStackDriftDetectionStatus,
  executeCloudformationDescribeStackEvents,
  executeCloudformationDescribeStacks,
  executeCloudformationDetectStackDrift,
  executeCloudformationExecuteChangeSet,
  executeCloudformationGetTemplate,
  executeCloudformationGetTemplateSummary,
  executeCloudformationListStackResources,
  executeCloudformationUpdateStack,
  executeCloudformationValidateTemplate,
} from '@/lib/internal/cloudformation/operations'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

async function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  input: unknown,
  execute: (input: ContractBody<C>, signal?: AbortSignal) => Promise<unknown>,
  fallbackError: string,
  signal?: AbortSignal
): Promise<Response> {
  signal?.throwIfAborted()
  const parsed = parseInternalToolInput(contract, input)
  if (!parsed.success) return parsed.response

  try {
    const result = await execute(parsed.data, signal)
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    return Response.json({ error: getErrorMessage(error, fallbackError) }, { status: 500 })
  }
}

export const executeCloudformationTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  signal,
}) => {
  signal?.throwIfAborted()
  switch (toolId) {
    case 'cloudformation_cancel_update_stack':
      return executeOperation(
        awsCloudformationCancelUpdateStackContract,
        input,
        executeCloudformationCancelUpdateStack,
        'Failed to cancel CloudFormation stack update',
        signal
      )
    case 'cloudformation_create_change_set':
      return executeOperation(
        awsCloudformationCreateChangeSetContract,
        input,
        executeCloudformationCreateChangeSet,
        'Failed to create CloudFormation change set',
        signal
      )
    case 'cloudformation_create_stack':
      return executeOperation(
        awsCloudformationCreateStackContract,
        input,
        executeCloudformationCreateStack,
        'Failed to create CloudFormation stack',
        signal
      )
    case 'cloudformation_delete_stack':
      return executeOperation(
        awsCloudformationDeleteStackContract,
        input,
        executeCloudformationDeleteStack,
        'Failed to delete CloudFormation stack',
        signal
      )
    case 'cloudformation_describe_change_set':
      return executeOperation(
        awsCloudformationDescribeChangeSetContract,
        input,
        executeCloudformationDescribeChangeSet,
        'Failed to describe CloudFormation change set',
        signal
      )
    case 'cloudformation_describe_stack_drift_detection_status':
      return executeOperation(
        awsCloudformationDescribeStackDriftDetectionStatusContract,
        input,
        executeCloudformationDescribeStackDriftDetectionStatus,
        'Failed to describe stack drift detection status',
        signal
      )
    case 'cloudformation_describe_stack_events':
      return executeOperation(
        awsCloudformationDescribeStackEventsContract,
        input,
        executeCloudformationDescribeStackEvents,
        'Failed to describe CloudFormation stack events',
        signal
      )
    case 'cloudformation_describe_stacks':
      return executeOperation(
        awsCloudformationDescribeStacksContract,
        input,
        executeCloudformationDescribeStacks,
        'Failed to describe CloudFormation stacks',
        signal
      )
    case 'cloudformation_detect_stack_drift':
      return executeOperation(
        awsCloudformationDetectStackDriftContract,
        input,
        executeCloudformationDetectStackDrift,
        'Failed to detect CloudFormation stack drift',
        signal
      )
    case 'cloudformation_execute_change_set':
      return executeOperation(
        awsCloudformationExecuteChangeSetContract,
        input,
        executeCloudformationExecuteChangeSet,
        'Failed to execute CloudFormation change set',
        signal
      )
    case 'cloudformation_get_template_summary':
      return executeOperation(
        awsCloudformationGetTemplateSummaryContract,
        input,
        executeCloudformationGetTemplateSummary,
        'Failed to get CloudFormation template summary',
        signal
      )
    case 'cloudformation_get_template':
      return executeOperation(
        awsCloudformationGetTemplateContract,
        input,
        executeCloudformationGetTemplate,
        'Failed to get CloudFormation template',
        signal
      )
    case 'cloudformation_list_stack_resources':
      return executeOperation(
        awsCloudformationListStackResourcesContract,
        input,
        executeCloudformationListStackResources,
        'Failed to list CloudFormation stack resources',
        signal
      )
    case 'cloudformation_update_stack':
      return executeOperation(
        awsCloudformationUpdateStackContract,
        input,
        executeCloudformationUpdateStack,
        'Failed to update CloudFormation stack',
        signal
      )
    case 'cloudformation_validate_template':
      return executeOperation(
        awsCloudformationValidateTemplateContract,
        input,
        executeCloudformationValidateTemplate,
        'Failed to validate CloudFormation template',
        signal
      )
    default:
      return Response.json({ error: `Unsupported CloudFormation tool: ${toolId}` }, { status: 500 })
  }
}
