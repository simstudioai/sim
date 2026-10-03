import type { AwsSsmCancelCommandBody } from '@/lib/api/contracts/tools/aws/ssm-cancel-command'
import type { AwsSsmDeleteParameterBody } from '@/lib/api/contracts/tools/aws/ssm-delete-parameter'
import type { AwsSsmDescribeAutomationExecutionsBody } from '@/lib/api/contracts/tools/aws/ssm-describe-automation-executions'
import type { AwsSsmDescribeInstanceInformationBody } from '@/lib/api/contracts/tools/aws/ssm-describe-instance-information'
import type { AwsSsmDescribeInstancePatchStatesBody } from '@/lib/api/contracts/tools/aws/ssm-describe-instance-patch-states'
import type { AwsSsmDescribeInstancePatchesBody } from '@/lib/api/contracts/tools/aws/ssm-describe-instance-patches'
import type { AwsSsmDescribeParametersBody } from '@/lib/api/contracts/tools/aws/ssm-describe-parameters'
import type { AwsSsmGetAutomationExecutionBody } from '@/lib/api/contracts/tools/aws/ssm-get-automation-execution'
import type { AwsSsmGetCommandInvocationBody } from '@/lib/api/contracts/tools/aws/ssm-get-command-invocation'
import type { AwsSsmGetDocumentBody } from '@/lib/api/contracts/tools/aws/ssm-get-document'
import type { AwsSsmGetParameterBody } from '@/lib/api/contracts/tools/aws/ssm-get-parameter'
import type { AwsSsmGetParametersBody } from '@/lib/api/contracts/tools/aws/ssm-get-parameters'
import type { AwsSsmGetParametersByPathBody } from '@/lib/api/contracts/tools/aws/ssm-get-parameters-by-path'
import type { AwsSsmListCommandInvocationsBody } from '@/lib/api/contracts/tools/aws/ssm-list-command-invocations'
import type { AwsSsmListCommandsBody } from '@/lib/api/contracts/tools/aws/ssm-list-commands'
import type { AwsSsmListComplianceItemsBody } from '@/lib/api/contracts/tools/aws/ssm-list-compliance-items'
import type { AwsSsmListComplianceSummariesBody } from '@/lib/api/contracts/tools/aws/ssm-list-compliance-summaries'
import type { AwsSsmListDocumentsBody } from '@/lib/api/contracts/tools/aws/ssm-list-documents'
import type { AwsSsmPutParameterBody } from '@/lib/api/contracts/tools/aws/ssm-put-parameter'
import type { AwsSsmSendCommandBody } from '@/lib/api/contracts/tools/aws/ssm-send-command'
import type { AwsSsmStartAutomationExecutionBody } from '@/lib/api/contracts/tools/aws/ssm-start-automation-execution'
import type { AwsSsmStopAutomationExecutionBody } from '@/lib/api/contracts/tools/aws/ssm-stop-automation-execution'
import {
  cancelCommand,
  createSsmClient,
  deleteParameter,
  describeAutomationExecutions,
  describeInstanceInformation,
  describeInstancePatches,
  describeInstancePatchStates,
  describeParameters,
  getAutomationExecution,
  getCommandInvocation,
  getDocument,
  getParameter,
  getParameters,
  getParametersByPath,
  listCommandInvocations,
  listCommands,
  listComplianceItems,
  listComplianceSummaries,
  listDocuments,
  putParameter,
  sendCommand,
  startAutomationExecution,
  stopAutomationExecution,
} from '@/lib/internal/ssm/client'

export async function executeSsmSendCommand(input: AwsSsmSendCommandBody, signal?: AbortSignal) {
  const client = createSsmClient(input)
  try {
    return await sendCommand(client, input, signal)
  } finally {
    client.destroy()
  }
}

export async function executeSsmListCommands(input: AwsSsmListCommandsBody, signal?: AbortSignal) {
  const client = createSsmClient(input)
  try {
    return await listCommands(client, input, signal)
  } finally {
    client.destroy()
  }
}

export async function executeSsmListCommandInvocations(
  input: AwsSsmListCommandInvocationsBody,
  signal?: AbortSignal
) {
  const client = createSsmClient(input)
  try {
    return await listCommandInvocations(client, input, signal)
  } finally {
    client.destroy()
  }
}

export async function executeSsmGetCommandInvocation(
  input: AwsSsmGetCommandInvocationBody,
  signal?: AbortSignal
) {
  const client = createSsmClient(input)
  try {
    return await getCommandInvocation(client, input, signal)
  } finally {
    client.destroy()
  }
}

export async function executeSsmCancelCommand(
  input: AwsSsmCancelCommandBody,
  signal?: AbortSignal
) {
  const client = createSsmClient(input)
  try {
    return await cancelCommand(client, input, signal)
  } finally {
    client.destroy()
  }
}

export async function executeSsmGetParameter(input: AwsSsmGetParameterBody, signal?: AbortSignal) {
  const client = createSsmClient(input)
  try {
    return await getParameter(client, input, signal)
  } finally {
    client.destroy()
  }
}

export async function executeSsmGetParameters(
  input: AwsSsmGetParametersBody,
  signal?: AbortSignal
) {
  const client = createSsmClient(input)
  try {
    return await getParameters(client, input, signal)
  } finally {
    client.destroy()
  }
}

export async function executeSsmGetParametersByPath(
  input: AwsSsmGetParametersByPathBody,
  signal?: AbortSignal
) {
  const client = createSsmClient(input)
  try {
    return await getParametersByPath(client, input, signal)
  } finally {
    client.destroy()
  }
}

export async function executeSsmPutParameter(input: AwsSsmPutParameterBody, signal?: AbortSignal) {
  const client = createSsmClient(input)
  try {
    return await putParameter(client, input, signal)
  } finally {
    client.destroy()
  }
}

export async function executeSsmDeleteParameter(
  input: AwsSsmDeleteParameterBody,
  signal?: AbortSignal
) {
  const client = createSsmClient(input)
  try {
    return await deleteParameter(client, input, signal)
  } finally {
    client.destroy()
  }
}

export async function executeSsmDescribeParameters(
  input: AwsSsmDescribeParametersBody,
  signal?: AbortSignal
) {
  const client = createSsmClient(input)
  try {
    return await describeParameters(client, input, signal)
  } finally {
    client.destroy()
  }
}

export async function executeSsmDescribeInstanceInformation(
  input: AwsSsmDescribeInstanceInformationBody,
  signal?: AbortSignal
) {
  const client = createSsmClient(input)
  try {
    return await describeInstanceInformation(client, input, signal)
  } finally {
    client.destroy()
  }
}

export async function executeSsmDescribeInstancePatches(
  input: AwsSsmDescribeInstancePatchesBody,
  signal?: AbortSignal
) {
  const client = createSsmClient(input)
  try {
    return await describeInstancePatches(client, input, signal)
  } finally {
    client.destroy()
  }
}

export async function executeSsmDescribeInstancePatchStates(
  input: AwsSsmDescribeInstancePatchStatesBody,
  signal?: AbortSignal
) {
  const client = createSsmClient(input)
  try {
    return await describeInstancePatchStates(client, input, signal)
  } finally {
    client.destroy()
  }
}

export async function executeSsmListComplianceItems(
  input: AwsSsmListComplianceItemsBody,
  signal?: AbortSignal
) {
  const client = createSsmClient(input)
  try {
    return await listComplianceItems(client, input, signal)
  } finally {
    client.destroy()
  }
}

export async function executeSsmListComplianceSummaries(
  input: AwsSsmListComplianceSummariesBody,
  signal?: AbortSignal
) {
  const client = createSsmClient(input)
  try {
    return await listComplianceSummaries(client, input, signal)
  } finally {
    client.destroy()
  }
}

export async function executeSsmStartAutomationExecution(
  input: AwsSsmStartAutomationExecutionBody,
  signal?: AbortSignal
) {
  const client = createSsmClient(input)
  try {
    return await startAutomationExecution(client, input, signal)
  } finally {
    client.destroy()
  }
}

export async function executeSsmDescribeAutomationExecutions(
  input: AwsSsmDescribeAutomationExecutionsBody,
  signal?: AbortSignal
) {
  const client = createSsmClient(input)
  try {
    return await describeAutomationExecutions(client, input, signal)
  } finally {
    client.destroy()
  }
}

export async function executeSsmGetAutomationExecution(
  input: AwsSsmGetAutomationExecutionBody,
  signal?: AbortSignal
) {
  const client = createSsmClient(input)
  try {
    return await getAutomationExecution(client, input, signal)
  } finally {
    client.destroy()
  }
}

export async function executeSsmStopAutomationExecution(
  input: AwsSsmStopAutomationExecutionBody,
  signal?: AbortSignal
) {
  const client = createSsmClient(input)
  try {
    return await stopAutomationExecution(client, input, signal)
  } finally {
    client.destroy()
  }
}

export async function executeSsmListDocuments(
  input: AwsSsmListDocumentsBody,
  signal?: AbortSignal
) {
  const client = createSsmClient(input)
  try {
    return await listDocuments(client, input, signal)
  } finally {
    client.destroy()
  }
}

export async function executeSsmGetDocument(input: AwsSsmGetDocumentBody, signal?: AbortSignal) {
  const client = createSsmClient(input)
  try {
    return await getDocument(client, input, signal)
  } finally {
    client.destroy()
  }
}
