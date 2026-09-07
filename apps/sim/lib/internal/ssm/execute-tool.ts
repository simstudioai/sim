import { getErrorMessage } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import { awsSsmCancelCommandContract } from '@/lib/api/contracts/tools/aws/ssm-cancel-command'
import { awsSsmDeleteParameterContract } from '@/lib/api/contracts/tools/aws/ssm-delete-parameter'
import { awsSsmDescribeAutomationExecutionsContract } from '@/lib/api/contracts/tools/aws/ssm-describe-automation-executions'
import { awsSsmDescribeInstanceInformationContract } from '@/lib/api/contracts/tools/aws/ssm-describe-instance-information'
import { awsSsmDescribeInstancePatchStatesContract } from '@/lib/api/contracts/tools/aws/ssm-describe-instance-patch-states'
import { awsSsmDescribeInstancePatchesContract } from '@/lib/api/contracts/tools/aws/ssm-describe-instance-patches'
import { awsSsmDescribeParametersContract } from '@/lib/api/contracts/tools/aws/ssm-describe-parameters'
import { awsSsmGetAutomationExecutionContract } from '@/lib/api/contracts/tools/aws/ssm-get-automation-execution'
import { awsSsmGetCommandInvocationContract } from '@/lib/api/contracts/tools/aws/ssm-get-command-invocation'
import { awsSsmGetDocumentContract } from '@/lib/api/contracts/tools/aws/ssm-get-document'
import { awsSsmGetParameterContract } from '@/lib/api/contracts/tools/aws/ssm-get-parameter'
import { awsSsmGetParametersContract } from '@/lib/api/contracts/tools/aws/ssm-get-parameters'
import { awsSsmGetParametersByPathContract } from '@/lib/api/contracts/tools/aws/ssm-get-parameters-by-path'
import { awsSsmListCommandInvocationsContract } from '@/lib/api/contracts/tools/aws/ssm-list-command-invocations'
import { awsSsmListCommandsContract } from '@/lib/api/contracts/tools/aws/ssm-list-commands'
import { awsSsmListComplianceItemsContract } from '@/lib/api/contracts/tools/aws/ssm-list-compliance-items'
import { awsSsmListComplianceSummariesContract } from '@/lib/api/contracts/tools/aws/ssm-list-compliance-summaries'
import { awsSsmListDocumentsContract } from '@/lib/api/contracts/tools/aws/ssm-list-documents'
import { awsSsmPutParameterContract } from '@/lib/api/contracts/tools/aws/ssm-put-parameter'
import { awsSsmSendCommandContract } from '@/lib/api/contracts/tools/aws/ssm-send-command'
import { awsSsmStartAutomationExecutionContract } from '@/lib/api/contracts/tools/aws/ssm-start-automation-execution'
import { awsSsmStopAutomationExecutionContract } from '@/lib/api/contracts/tools/aws/ssm-stop-automation-execution'
import {
  executeSsmCancelCommand,
  executeSsmDeleteParameter,
  executeSsmDescribeAutomationExecutions,
  executeSsmDescribeInstanceInformation,
  executeSsmDescribeInstancePatches,
  executeSsmDescribeInstancePatchStates,
  executeSsmDescribeParameters,
  executeSsmGetAutomationExecution,
  executeSsmGetCommandInvocation,
  executeSsmGetDocument,
  executeSsmGetParameter,
  executeSsmGetParameters,
  executeSsmGetParametersByPath,
  executeSsmListCommandInvocations,
  executeSsmListCommands,
  executeSsmListComplianceItems,
  executeSsmListComplianceSummaries,
  executeSsmListDocuments,
  executeSsmPutParameter,
  executeSsmSendCommand,
  executeSsmStartAutomationExecution,
  executeSsmStopAutomationExecution,
} from '@/lib/internal/ssm/operations'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

async function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  input: unknown,
  execute: (input: ContractBody<C>, signal?: AbortSignal) => Promise<unknown>,
  errorMessage: string,
  signal?: AbortSignal
): Promise<Response> {
  const parsed = parseInternalToolInput(contract, input)
  if (!parsed.success) return parsed.response

  try {
    const result = await execute(parsed.data, signal)
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    return Response.json(
      { error: `${errorMessage}: ${getErrorMessage(error, 'Unknown error occurred')}` },
      { status: 500 }
    )
  }
}

export const executeSsmTool: InternalToolOperationHandler = async ({ toolId, input, signal }) => {
  signal?.throwIfAborted()

  switch (toolId) {
    case 'ssm_send_command':
      return executeOperation(
        awsSsmSendCommandContract,
        input,
        executeSsmSendCommand,
        'Failed to send command',
        signal
      )
    case 'ssm_list_commands':
      return executeOperation(
        awsSsmListCommandsContract,
        input,
        executeSsmListCommands,
        'Failed to list commands',
        signal
      )
    case 'ssm_list_command_invocations':
      return executeOperation(
        awsSsmListCommandInvocationsContract,
        input,
        executeSsmListCommandInvocations,
        'Failed to list command invocations',
        signal
      )
    case 'ssm_get_command_invocation':
      return executeOperation(
        awsSsmGetCommandInvocationContract,
        input,
        executeSsmGetCommandInvocation,
        'Failed to get command invocation',
        signal
      )
    case 'ssm_cancel_command':
      return executeOperation(
        awsSsmCancelCommandContract,
        input,
        executeSsmCancelCommand,
        'Failed to cancel command',
        signal
      )
    case 'ssm_get_parameter':
      return executeOperation(
        awsSsmGetParameterContract,
        input,
        executeSsmGetParameter,
        'Failed to get parameter',
        signal
      )
    case 'ssm_get_parameters':
      return executeOperation(
        awsSsmGetParametersContract,
        input,
        executeSsmGetParameters,
        'Failed to get parameters',
        signal
      )
    case 'ssm_get_parameters_by_path':
      return executeOperation(
        awsSsmGetParametersByPathContract,
        input,
        executeSsmGetParametersByPath,
        'Failed to get parameters by path',
        signal
      )
    case 'ssm_put_parameter':
      return executeOperation(
        awsSsmPutParameterContract,
        input,
        executeSsmPutParameter,
        'Failed to put parameter',
        signal
      )
    case 'ssm_delete_parameter':
      return executeOperation(
        awsSsmDeleteParameterContract,
        input,
        executeSsmDeleteParameter,
        'Failed to delete parameter',
        signal
      )
    case 'ssm_describe_parameters':
      return executeOperation(
        awsSsmDescribeParametersContract,
        input,
        executeSsmDescribeParameters,
        'Failed to describe parameters',
        signal
      )
    case 'ssm_describe_instance_information':
      return executeOperation(
        awsSsmDescribeInstanceInformationContract,
        input,
        executeSsmDescribeInstanceInformation,
        'Failed to describe instance information',
        signal
      )
    case 'ssm_describe_instance_patches':
      return executeOperation(
        awsSsmDescribeInstancePatchesContract,
        input,
        executeSsmDescribeInstancePatches,
        'Failed to describe instance patches',
        signal
      )
    case 'ssm_describe_instance_patch_states':
      return executeOperation(
        awsSsmDescribeInstancePatchStatesContract,
        input,
        executeSsmDescribeInstancePatchStates,
        'Failed to describe instance patch states',
        signal
      )
    case 'ssm_list_compliance_items':
      return executeOperation(
        awsSsmListComplianceItemsContract,
        input,
        executeSsmListComplianceItems,
        'Failed to list compliance items',
        signal
      )
    case 'ssm_list_compliance_summaries':
      return executeOperation(
        awsSsmListComplianceSummariesContract,
        input,
        executeSsmListComplianceSummaries,
        'Failed to list compliance summaries',
        signal
      )
    case 'ssm_start_automation_execution':
      return executeOperation(
        awsSsmStartAutomationExecutionContract,
        input,
        executeSsmStartAutomationExecution,
        'Failed to start automation execution',
        signal
      )
    case 'ssm_describe_automation_executions':
      return executeOperation(
        awsSsmDescribeAutomationExecutionsContract,
        input,
        executeSsmDescribeAutomationExecutions,
        'Failed to describe automation executions',
        signal
      )
    case 'ssm_get_automation_execution':
      return executeOperation(
        awsSsmGetAutomationExecutionContract,
        input,
        executeSsmGetAutomationExecution,
        'Failed to get automation execution',
        signal
      )
    case 'ssm_stop_automation_execution':
      return executeOperation(
        awsSsmStopAutomationExecutionContract,
        input,
        executeSsmStopAutomationExecution,
        'Failed to stop automation execution',
        signal
      )
    case 'ssm_list_documents':
      return executeOperation(
        awsSsmListDocumentsContract,
        input,
        executeSsmListDocuments,
        'Failed to list documents',
        signal
      )
    case 'ssm_get_document':
      return executeOperation(
        awsSsmGetDocumentContract,
        input,
        executeSsmGetDocument,
        'Failed to get document',
        signal
      )
    default:
      return Response.json(
        { error: `Unsupported Systems Manager tool: ${toolId}` },
        { status: 500 }
      )
  }
}
