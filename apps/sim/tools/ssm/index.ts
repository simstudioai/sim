import { cancelCommandTool } from '@/tools/ssm/cancel_command'
import { deleteParameterTool } from '@/tools/ssm/delete_parameter'
import { describeAutomationExecutionsTool } from '@/tools/ssm/describe_automation_executions'
import { describeInstanceInformationTool } from '@/tools/ssm/describe_instance_information'
import { describeInstancePatchStatesTool } from '@/tools/ssm/describe_instance_patch_states'
import { describeInstancePatchesTool } from '@/tools/ssm/describe_instance_patches'
import { describeParametersTool } from '@/tools/ssm/describe_parameters'
import { getAutomationExecutionTool } from '@/tools/ssm/get_automation_execution'
import { getCommandInvocationTool } from '@/tools/ssm/get_command_invocation'
import { getDocumentTool } from '@/tools/ssm/get_document'
import { getParameterTool } from '@/tools/ssm/get_parameter'
import { getParametersTool } from '@/tools/ssm/get_parameters'
import { getParametersByPathTool } from '@/tools/ssm/get_parameters_by_path'
import { listCommandInvocationsTool } from '@/tools/ssm/list_command_invocations'
import { listCommandsTool } from '@/tools/ssm/list_commands'
import { listComplianceItemsTool } from '@/tools/ssm/list_compliance_items'
import { listComplianceSummariesTool } from '@/tools/ssm/list_compliance_summaries'
import { listDocumentsTool } from '@/tools/ssm/list_documents'
import { putParameterTool } from '@/tools/ssm/put_parameter'
import { sendCommandTool } from '@/tools/ssm/send_command'
import { startAutomationExecutionTool } from '@/tools/ssm/start_automation_execution'
import { stopAutomationExecutionTool } from '@/tools/ssm/stop_automation_execution'

export const ssmSendCommandTool = sendCommandTool
export const ssmListCommandsTool = listCommandsTool
export const ssmListCommandInvocationsTool = listCommandInvocationsTool
export const ssmGetCommandInvocationTool = getCommandInvocationTool
export const ssmCancelCommandTool = cancelCommandTool
export const ssmGetParameterTool = getParameterTool
export const ssmGetParametersTool = getParametersTool
export const ssmGetParametersByPathTool = getParametersByPathTool
export const ssmPutParameterTool = putParameterTool
export const ssmDeleteParameterTool = deleteParameterTool
export const ssmDescribeParametersTool = describeParametersTool
export const ssmDescribeInstanceInformationTool = describeInstanceInformationTool
export const ssmDescribeInstancePatchesTool = describeInstancePatchesTool
export const ssmDescribeInstancePatchStatesTool = describeInstancePatchStatesTool
export const ssmListComplianceItemsTool = listComplianceItemsTool
export const ssmListComplianceSummariesTool = listComplianceSummariesTool
export const ssmStartAutomationExecutionTool = startAutomationExecutionTool
export const ssmDescribeAutomationExecutionsTool = describeAutomationExecutionsTool
export const ssmGetAutomationExecutionTool = getAutomationExecutionTool
export const ssmStopAutomationExecutionTool = stopAutomationExecutionTool
export const ssmListDocumentsTool = listDocumentsTool
export const ssmGetDocumentTool = getDocumentTool

export * from '@/tools/ssm/types'
