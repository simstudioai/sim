import type {
  AutomationExecutionMetadata,
  Command,
  CommandInvocation,
  CommandPlugin,
  ComplianceItem,
  ComplianceSummaryItem,
  DocumentIdentifier,
  InstanceInformation,
  InstancePatchState,
  Parameter,
  ParameterMetadata,
  PatchComplianceData,
  SeveritySummary,
  StepExecution,
  Tag,
  Target,
} from '@aws-sdk/client-ssm'
import {
  CancelCommandCommand,
  DeleteParameterCommand,
  DescribeAutomationExecutionsCommand,
  DescribeInstanceInformationCommand,
  DescribeInstancePatchesCommand,
  DescribeInstancePatchStatesCommand,
  DescribeParametersCommand,
  GetAutomationExecutionCommand,
  GetCommandInvocationCommand,
  GetDocumentCommand,
  GetParameterCommand,
  GetParametersByPathCommand,
  GetParametersCommand,
  ListCommandInvocationsCommand,
  ListCommandsCommand,
  ListComplianceItemsCommand,
  ListComplianceSummariesCommand,
  ListDocumentsCommand,
  PutParameterCommand,
  SendCommandCommand,
  SSMClient,
  StartAutomationExecutionCommand,
  StopAutomationExecutionCommand,
} from '@aws-sdk/client-ssm'
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

interface SsmConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export function createSsmClient(config: SsmConnectionConfig): SSMClient {
  return new SSMClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

function isoDate(value: Date | undefined): string | null {
  return value?.toISOString() ?? null
}

function mapTargets(targets: Target[] | undefined) {
  return (targets ?? []).map((target) => ({
    key: target.Key ?? null,
    values: target.Values ?? [],
  }))
}

function mapTags(tags: Tag[] | undefined) {
  return (tags ?? []).map((tag) => ({ key: tag.Key ?? '', value: tag.Value ?? '' }))
}

function mapCommand(command: Command | undefined) {
  return {
    commandId: command?.CommandId ?? '',
    documentName: command?.DocumentName ?? '',
    documentVersion: command?.DocumentVersion ?? null,
    comment: command?.Comment ?? null,
    status: command?.Status ?? '',
    statusDetails: command?.StatusDetails ?? null,
    requestedDateTime: isoDate(command?.RequestedDateTime),
    expiresAfter: isoDate(command?.ExpiresAfter),
    instanceIds: command?.InstanceIds ?? [],
    targets: mapTargets(command?.Targets),
    maxConcurrency: command?.MaxConcurrency ?? null,
    maxErrors: command?.MaxErrors ?? null,
    targetCount: command?.TargetCount ?? null,
    completedCount: command?.CompletedCount ?? null,
    errorCount: command?.ErrorCount ?? null,
    deliveryTimedOutCount: command?.DeliveryTimedOutCount ?? null,
    executionTimeoutSeconds: command?.TimeoutSeconds ?? null,
    outputS3BucketName: command?.OutputS3BucketName ?? null,
    outputS3KeyPrefix: command?.OutputS3KeyPrefix ?? null,
    outputS3Region: command?.OutputS3Region ?? null,
    serviceRole: command?.ServiceRole ?? null,
  }
}

function mapCommandPlugin(plugin: CommandPlugin) {
  return {
    name: plugin.Name ?? '',
    status: plugin.Status ?? '',
    statusDetails: plugin.StatusDetails ?? null,
    responseCode: plugin.ResponseCode ?? null,
    responseStartDateTime: isoDate(plugin.ResponseStartDateTime),
    responseFinishDateTime: isoDate(plugin.ResponseFinishDateTime),
    output: plugin.Output ?? null,
    standardOutputUrl: plugin.StandardOutputUrl ?? null,
    standardErrorUrl: plugin.StandardErrorUrl ?? null,
  }
}

function mapCommandInvocation(invocation: CommandInvocation) {
  return {
    commandId: invocation.CommandId ?? '',
    instanceId: invocation.InstanceId ?? '',
    instanceName: invocation.InstanceName ?? null,
    documentName: invocation.DocumentName ?? null,
    documentVersion: invocation.DocumentVersion ?? null,
    comment: invocation.Comment ?? null,
    requestedDateTime: isoDate(invocation.RequestedDateTime),
    status: invocation.Status ?? '',
    statusDetails: invocation.StatusDetails ?? null,
    traceOutput: invocation.TraceOutput ?? null,
    standardOutputUrl: invocation.StandardOutputUrl ?? null,
    standardErrorUrl: invocation.StandardErrorUrl ?? null,
    serviceRole: invocation.ServiceRole ?? null,
    commandPlugins: (invocation.CommandPlugins ?? []).map(mapCommandPlugin),
  }
}

function mapParameter(parameter: Parameter) {
  return {
    name: parameter.Name ?? '',
    type: parameter.Type ?? '',
    value: parameter.Value ?? '',
    version: parameter.Version ?? null,
    selector: parameter.Selector ?? null,
    sourceResult: parameter.SourceResult ?? null,
    lastModifiedDate: isoDate(parameter.LastModifiedDate),
    arn: parameter.ARN ?? '',
    dataType: parameter.DataType ?? null,
  }
}

function mapParameterMetadata(metadata: ParameterMetadata) {
  return {
    name: metadata.Name ?? '',
    arn: metadata.ARN ?? '',
    type: metadata.Type ?? '',
    keyId: metadata.KeyId ?? null,
    lastModifiedDate: isoDate(metadata.LastModifiedDate),
    lastModifiedUser: metadata.LastModifiedUser ?? null,
    description: metadata.Description ?? null,
    allowedPattern: metadata.AllowedPattern ?? null,
    version: metadata.Version ?? null,
    tier: metadata.Tier ?? null,
    dataType: metadata.DataType ?? null,
    policies: (metadata.Policies ?? []).map((policy) => ({
      policyText: policy.PolicyText ?? null,
      policyType: policy.PolicyType ?? null,
      policyStatus: policy.PolicyStatus ?? null,
    })),
  }
}

function mapInstanceInformation(instance: InstanceInformation) {
  return {
    instanceId: instance.InstanceId ?? '',
    pingStatus: instance.PingStatus ?? '',
    lastPingDateTime: isoDate(instance.LastPingDateTime),
    agentVersion: instance.AgentVersion ?? null,
    isLatestVersion: instance.IsLatestVersion ?? null,
    platformType: instance.PlatformType ?? null,
    platformName: instance.PlatformName ?? null,
    platformVersion: instance.PlatformVersion ?? null,
    activationId: instance.ActivationId ?? null,
    iamRole: instance.IamRole ?? null,
    registrationDate: isoDate(instance.RegistrationDate),
    resourceType: instance.ResourceType ?? null,
    name: instance.Name ?? null,
    ipAddress: instance.IPAddress ?? null,
    computerName: instance.ComputerName ?? null,
    associationStatus: instance.AssociationStatus ?? null,
    lastAssociationExecutionDate: isoDate(instance.LastAssociationExecutionDate),
    lastSuccessfulAssociationExecutionDate: isoDate(
      instance.LastSuccessfulAssociationExecutionDate
    ),
    sourceId: instance.SourceId ?? null,
    sourceType: instance.SourceType ?? null,
  }
}

function mapPatchComplianceData(patch: PatchComplianceData) {
  return {
    title: patch.Title ?? '',
    kbId: patch.KBId ?? '',
    classification: patch.Classification ?? '',
    severity: patch.Severity ?? '',
    state: patch.State ?? '',
    installedTime: isoDate(patch.InstalledTime),
    cveIds: patch.CVEIds ?? null,
  }
}

function mapInstancePatchState(state: InstancePatchState) {
  return {
    instanceId: state.InstanceId ?? '',
    patchGroup: state.PatchGroup ?? '',
    baselineId: state.BaselineId ?? '',
    snapshotId: state.SnapshotId ?? null,
    ownerInformation: state.OwnerInformation ?? null,
    installedCount: state.InstalledCount ?? null,
    installedOtherCount: state.InstalledOtherCount ?? null,
    installedPendingRebootCount: state.InstalledPendingRebootCount ?? null,
    installedRejectedCount: state.InstalledRejectedCount ?? null,
    missingCount: state.MissingCount ?? null,
    failedCount: state.FailedCount ?? null,
    unreportedNotApplicableCount: state.UnreportedNotApplicableCount ?? null,
    notApplicableCount: state.NotApplicableCount ?? null,
    criticalNonCompliantCount: state.CriticalNonCompliantCount ?? null,
    securityNonCompliantCount: state.SecurityNonCompliantCount ?? null,
    otherNonCompliantCount: state.OtherNonCompliantCount ?? null,
    operation: state.Operation ?? '',
    operationStartTime: isoDate(state.OperationStartTime),
    operationEndTime: isoDate(state.OperationEndTime),
    lastNoRebootInstallOperationTime: isoDate(state.LastNoRebootInstallOperationTime),
    rebootOption: state.RebootOption ?? null,
  }
}

function mapComplianceItem(item: ComplianceItem) {
  return {
    complianceType: item.ComplianceType ?? '',
    resourceType: item.ResourceType ?? '',
    resourceId: item.ResourceId ?? '',
    id: item.Id ?? '',
    title: item.Title ?? '',
    status: item.Status ?? '',
    severity: item.Severity ?? '',
    executionTime: isoDate(item.ExecutionSummary?.ExecutionTime),
    executionId: item.ExecutionSummary?.ExecutionId ?? null,
    executionType: item.ExecutionSummary?.ExecutionType ?? null,
    details: item.Details ?? null,
  }
}

function mapSeveritySummary(summary: SeveritySummary | undefined) {
  if (!summary) return null
  return {
    criticalCount: summary.CriticalCount ?? null,
    highCount: summary.HighCount ?? null,
    mediumCount: summary.MediumCount ?? null,
    lowCount: summary.LowCount ?? null,
    informationalCount: summary.InformationalCount ?? null,
    unspecifiedCount: summary.UnspecifiedCount ?? null,
  }
}

function mapComplianceSummaryItem(item: ComplianceSummaryItem) {
  return {
    complianceType: item.ComplianceType ?? '',
    compliantCount: item.CompliantSummary?.CompliantCount ?? null,
    compliantSeveritySummary: mapSeveritySummary(item.CompliantSummary?.SeveritySummary),
    nonCompliantCount: item.NonCompliantSummary?.NonCompliantCount ?? null,
    nonCompliantSeveritySummary: mapSeveritySummary(item.NonCompliantSummary?.SeveritySummary),
  }
}

function mapAutomationExecutionMetadata(execution: AutomationExecutionMetadata) {
  return {
    automationExecutionId: execution.AutomationExecutionId ?? '',
    documentName: execution.DocumentName ?? '',
    documentVersion: execution.DocumentVersion ?? null,
    automationExecutionStatus: execution.AutomationExecutionStatus ?? '',
    executionStartTime: isoDate(execution.ExecutionStartTime),
    executionEndTime: isoDate(execution.ExecutionEndTime),
    executedBy: execution.ExecutedBy ?? null,
    logFile: execution.LogFile ?? null,
    mode: execution.Mode ?? null,
    parentAutomationExecutionId: execution.ParentAutomationExecutionId ?? null,
    currentStepName: execution.CurrentStepName ?? null,
    currentAction: execution.CurrentAction ?? null,
    failureMessage: execution.FailureMessage ?? null,
    targetParameterName: execution.TargetParameterName ?? null,
    target: execution.Target ?? null,
    automationType: execution.AutomationType ?? null,
    maxConcurrency: execution.MaxConcurrency ?? null,
    maxErrors: execution.MaxErrors ?? null,
    outputs: execution.Outputs ?? null,
  }
}

function mapStepExecution(step: StepExecution) {
  return {
    stepName: step.StepName ?? null,
    action: step.Action ?? null,
    stepStatus: step.StepStatus ?? null,
    stepExecutionId: step.StepExecutionId ?? null,
    executionStartTime: isoDate(step.ExecutionStartTime),
    executionEndTime: isoDate(step.ExecutionEndTime),
    failureMessage: step.FailureMessage ?? null,
    response: step.Response ?? null,
    isEnd: step.IsEnd ?? null,
    nextStep: step.NextStep ?? null,
  }
}

function mapDocumentIdentifier(document: DocumentIdentifier) {
  return {
    name: document.Name ?? '',
    displayName: document.DisplayName ?? null,
    owner: document.Owner ?? null,
    createdDate: isoDate(document.CreatedDate),
    versionName: document.VersionName ?? null,
    documentVersion: document.DocumentVersion ?? null,
    documentType: document.DocumentType ?? null,
    documentFormat: document.DocumentFormat ?? null,
    schemaVersion: document.SchemaVersion ?? null,
    platformTypes: document.PlatformTypes ?? [],
    targetType: document.TargetType ?? null,
    reviewStatus: document.ReviewStatus ?? null,
    author: document.Author ?? null,
    tags: mapTags(document.Tags),
  }
}

export async function sendCommand(
  client: SSMClient,
  input: AwsSsmSendCommandBody,
  signal?: AbortSignal
) {
  const response = await client.send(
    new SendCommandCommand({
      DocumentName: input.documentName,
      ...(input.documentVersion ? { DocumentVersion: input.documentVersion } : {}),
      ...(input.instanceIds?.length ? { InstanceIds: input.instanceIds } : {}),
      ...(input.targets?.length ? { Targets: input.targets } : {}),
      ...(input.comment ? { Comment: input.comment } : {}),
      ...(input.parameters ? { Parameters: input.parameters } : {}),
      ...(input.executionTimeoutSeconds != null
        ? { TimeoutSeconds: input.executionTimeoutSeconds }
        : {}),
      ...(input.maxConcurrency ? { MaxConcurrency: input.maxConcurrency } : {}),
      ...(input.maxErrors ? { MaxErrors: input.maxErrors } : {}),
      ...(input.outputS3BucketName ? { OutputS3BucketName: input.outputS3BucketName } : {}),
      ...(input.outputS3KeyPrefix ? { OutputS3KeyPrefix: input.outputS3KeyPrefix } : {}),
      ...(input.serviceRoleArn ? { ServiceRoleArn: input.serviceRoleArn } : {}),
    }),
    { abortSignal: signal }
  )

  return mapCommand(response.Command)
}

export async function listCommands(
  client: SSMClient,
  input: AwsSsmListCommandsBody,
  signal?: AbortSignal
) {
  const response = await client.send(
    new ListCommandsCommand({
      ...(input.commandId ? { CommandId: input.commandId } : {}),
      ...(input.instanceId ? { InstanceId: input.instanceId } : {}),
      ...(input.filters?.length
        ? { Filters: input.filters.map((filter) => ({ key: filter.key, value: filter.value })) }
        : {}),
      ...(input.maxResults != null ? { MaxResults: input.maxResults } : {}),
      ...(input.nextToken ? { NextToken: input.nextToken } : {}),
    }),
    { abortSignal: signal }
  )

  const commands = (response.Commands ?? []).map((command) => mapCommand(command))
  return { commands, nextToken: response.NextToken ?? null, count: commands.length }
}

export async function listCommandInvocations(
  client: SSMClient,
  input: AwsSsmListCommandInvocationsBody,
  signal?: AbortSignal
) {
  const response = await client.send(
    new ListCommandInvocationsCommand({
      ...(input.commandId ? { CommandId: input.commandId } : {}),
      ...(input.instanceId ? { InstanceId: input.instanceId } : {}),
      ...(input.filters?.length
        ? { Filters: input.filters.map((filter) => ({ key: filter.key, value: filter.value })) }
        : {}),
      ...(input.details != null ? { Details: input.details } : {}),
      ...(input.maxResults != null ? { MaxResults: input.maxResults } : {}),
      ...(input.nextToken ? { NextToken: input.nextToken } : {}),
    }),
    { abortSignal: signal }
  )

  const commandInvocations = (response.CommandInvocations ?? []).map(mapCommandInvocation)
  return {
    commandInvocations,
    nextToken: response.NextToken ?? null,
    count: commandInvocations.length,
  }
}

export async function getCommandInvocation(
  client: SSMClient,
  input: AwsSsmGetCommandInvocationBody,
  signal?: AbortSignal
) {
  const response = await client.send(
    new GetCommandInvocationCommand({
      CommandId: input.commandId,
      InstanceId: input.instanceId,
      ...(input.pluginName ? { PluginName: input.pluginName } : {}),
    }),
    { abortSignal: signal }
  )

  return {
    commandId: response.CommandId ?? '',
    instanceId: response.InstanceId ?? '',
    comment: response.Comment ?? null,
    documentName: response.DocumentName ?? null,
    documentVersion: response.DocumentVersion ?? null,
    pluginName: response.PluginName ?? null,
    responseCode: response.ResponseCode ?? null,
    executionStartDateTime: response.ExecutionStartDateTime ?? null,
    executionElapsedTime: response.ExecutionElapsedTime ?? null,
    executionEndDateTime: response.ExecutionEndDateTime ?? null,
    status: response.Status ?? '',
    statusDetails: response.StatusDetails ?? null,
    standardOutputContent: response.StandardOutputContent ?? '',
    standardOutputUrl: response.StandardOutputUrl ?? null,
    standardErrorContent: response.StandardErrorContent ?? '',
    standardErrorUrl: response.StandardErrorUrl ?? null,
  }
}

export async function cancelCommand(
  client: SSMClient,
  input: AwsSsmCancelCommandBody,
  signal?: AbortSignal
) {
  await client.send(
    new CancelCommandCommand({
      CommandId: input.commandId,
      ...(input.instanceIds?.length ? { InstanceIds: input.instanceIds } : {}),
    }),
    { abortSignal: signal }
  )

  return { message: 'Command cancellation requested', commandId: input.commandId }
}

export async function getParameter(
  client: SSMClient,
  input: AwsSsmGetParameterBody,
  signal?: AbortSignal
) {
  const response = await client.send(
    new GetParameterCommand({
      Name: input.name,
      ...(input.withDecryption != null ? { WithDecryption: input.withDecryption } : {}),
    }),
    { abortSignal: signal }
  )

  return mapParameter(response.Parameter ?? {})
}

export async function getParameters(
  client: SSMClient,
  input: AwsSsmGetParametersBody,
  signal?: AbortSignal
) {
  const response = await client.send(
    new GetParametersCommand({
      Names: input.names,
      ...(input.withDecryption != null ? { WithDecryption: input.withDecryption } : {}),
    }),
    { abortSignal: signal }
  )

  const parameters = (response.Parameters ?? []).map(mapParameter)
  return {
    parameters,
    invalidParameters: response.InvalidParameters ?? [],
    count: parameters.length,
  }
}

export async function getParametersByPath(
  client: SSMClient,
  input: AwsSsmGetParametersByPathBody,
  signal?: AbortSignal
) {
  const response = await client.send(
    new GetParametersByPathCommand({
      Path: input.path,
      ...(input.recursive != null ? { Recursive: input.recursive } : {}),
      ...(input.withDecryption != null ? { WithDecryption: input.withDecryption } : {}),
      ...(input.parameterFilters?.length ? { ParameterFilters: input.parameterFilters } : {}),
      ...(input.maxResults != null ? { MaxResults: input.maxResults } : {}),
      ...(input.nextToken ? { NextToken: input.nextToken } : {}),
    }),
    { abortSignal: signal }
  )

  const parameters = (response.Parameters ?? []).map(mapParameter)
  return { parameters, nextToken: response.NextToken ?? null, count: parameters.length }
}

export async function putParameter(
  client: SSMClient,
  input: AwsSsmPutParameterBody,
  signal?: AbortSignal
) {
  const response = await client.send(
    new PutParameterCommand({
      Name: input.name,
      Value: input.value,
      ...(input.type ? { Type: input.type } : {}),
      ...(input.description ? { Description: input.description } : {}),
      ...(input.keyId ? { KeyId: input.keyId } : {}),
      ...(input.overwrite != null ? { Overwrite: input.overwrite } : {}),
      ...(input.allowedPattern ? { AllowedPattern: input.allowedPattern } : {}),
      ...(input.tier ? { Tier: input.tier } : {}),
      ...(input.dataType ? { DataType: input.dataType } : {}),
      ...(input.policies ? { Policies: input.policies } : {}),
    }),
    { abortSignal: signal }
  )

  return {
    message: `Parameter "${input.name}" written successfully`,
    name: input.name,
    version: response.Version ?? null,
    tier: response.Tier ?? null,
  }
}

export async function deleteParameter(
  client: SSMClient,
  input: AwsSsmDeleteParameterBody,
  signal?: AbortSignal
) {
  await client.send(new DeleteParameterCommand({ Name: input.name }), { abortSignal: signal })
  return { message: `Parameter "${input.name}" deleted successfully`, name: input.name }
}

export async function describeParameters(
  client: SSMClient,
  input: AwsSsmDescribeParametersBody,
  signal?: AbortSignal
) {
  const response = await client.send(
    new DescribeParametersCommand({
      ...(input.parameterFilters?.length ? { ParameterFilters: input.parameterFilters } : {}),
      ...(input.shared != null ? { Shared: input.shared } : {}),
      ...(input.maxResults != null ? { MaxResults: input.maxResults } : {}),
      ...(input.nextToken ? { NextToken: input.nextToken } : {}),
    }),
    { abortSignal: signal }
  )

  const parameters = (response.Parameters ?? []).map(mapParameterMetadata)
  return { parameters, nextToken: response.NextToken ?? null, count: parameters.length }
}

export async function describeInstanceInformation(
  client: SSMClient,
  input: AwsSsmDescribeInstanceInformationBody,
  signal?: AbortSignal
) {
  const response = await client.send(
    new DescribeInstanceInformationCommand({
      ...(input.filters?.length ? { Filters: input.filters } : {}),
      ...(input.maxResults != null ? { MaxResults: input.maxResults } : {}),
      ...(input.nextToken ? { NextToken: input.nextToken } : {}),
    }),
    { abortSignal: signal }
  )

  const instances = (response.InstanceInformationList ?? []).map(mapInstanceInformation)
  return { instances, nextToken: response.NextToken ?? null, count: instances.length }
}

export async function describeInstancePatches(
  client: SSMClient,
  input: AwsSsmDescribeInstancePatchesBody,
  signal?: AbortSignal
) {
  const response = await client.send(
    new DescribeInstancePatchesCommand({
      InstanceId: input.instanceId,
      ...(input.filters?.length ? { Filters: input.filters } : {}),
      ...(input.maxResults != null ? { MaxResults: input.maxResults } : {}),
      ...(input.nextToken ? { NextToken: input.nextToken } : {}),
    }),
    { abortSignal: signal }
  )

  const patches = (response.Patches ?? []).map(mapPatchComplianceData)
  return { patches, nextToken: response.NextToken ?? null, count: patches.length }
}

export async function describeInstancePatchStates(
  client: SSMClient,
  input: AwsSsmDescribeInstancePatchStatesBody,
  signal?: AbortSignal
) {
  const response = await client.send(
    new DescribeInstancePatchStatesCommand({
      InstanceIds: input.instanceIds,
      ...(input.maxResults != null ? { MaxResults: input.maxResults } : {}),
      ...(input.nextToken ? { NextToken: input.nextToken } : {}),
    }),
    { abortSignal: signal }
  )

  const instancePatchStates = (response.InstancePatchStates ?? []).map(mapInstancePatchState)
  return {
    instancePatchStates,
    nextToken: response.NextToken ?? null,
    count: instancePatchStates.length,
  }
}

export async function listComplianceItems(
  client: SSMClient,
  input: AwsSsmListComplianceItemsBody,
  signal?: AbortSignal
) {
  const response = await client.send(
    new ListComplianceItemsCommand({
      ...(input.resourceIds?.length ? { ResourceIds: input.resourceIds } : {}),
      ...(input.resourceTypes?.length ? { ResourceTypes: input.resourceTypes } : {}),
      ...(input.filters?.length ? { Filters: input.filters } : {}),
      ...(input.maxResults != null ? { MaxResults: input.maxResults } : {}),
      ...(input.nextToken ? { NextToken: input.nextToken } : {}),
    }),
    { abortSignal: signal }
  )

  const complianceItems = (response.ComplianceItems ?? []).map(mapComplianceItem)
  return { complianceItems, nextToken: response.NextToken ?? null, count: complianceItems.length }
}

export async function listComplianceSummaries(
  client: SSMClient,
  input: AwsSsmListComplianceSummariesBody,
  signal?: AbortSignal
) {
  const response = await client.send(
    new ListComplianceSummariesCommand({
      ...(input.filters?.length ? { Filters: input.filters } : {}),
      ...(input.maxResults != null ? { MaxResults: input.maxResults } : {}),
      ...(input.nextToken ? { NextToken: input.nextToken } : {}),
    }),
    { abortSignal: signal }
  )

  const complianceSummaryItems = (response.ComplianceSummaryItems ?? []).map(
    mapComplianceSummaryItem
  )
  return {
    complianceSummaryItems,
    nextToken: response.NextToken ?? null,
    count: complianceSummaryItems.length,
  }
}

export async function startAutomationExecution(
  client: SSMClient,
  input: AwsSsmStartAutomationExecutionBody,
  signal?: AbortSignal
) {
  const response = await client.send(
    new StartAutomationExecutionCommand({
      DocumentName: input.documentName,
      ...(input.documentVersion ? { DocumentVersion: input.documentVersion } : {}),
      ...(input.parameters ? { Parameters: input.parameters } : {}),
      ...(input.mode ? { Mode: input.mode } : {}),
      ...(input.targetParameterName ? { TargetParameterName: input.targetParameterName } : {}),
      ...(input.targets?.length ? { Targets: input.targets } : {}),
      ...(input.maxConcurrency ? { MaxConcurrency: input.maxConcurrency } : {}),
      ...(input.maxErrors ? { MaxErrors: input.maxErrors } : {}),
      ...(input.clientToken ? { ClientToken: input.clientToken } : {}),
    }),
    { abortSignal: signal }
  )

  return { automationExecutionId: response.AutomationExecutionId ?? '' }
}

export async function describeAutomationExecutions(
  client: SSMClient,
  input: AwsSsmDescribeAutomationExecutionsBody,
  signal?: AbortSignal
) {
  const response = await client.send(
    new DescribeAutomationExecutionsCommand({
      ...(input.filters?.length ? { Filters: input.filters } : {}),
      ...(input.maxResults != null ? { MaxResults: input.maxResults } : {}),
      ...(input.nextToken ? { NextToken: input.nextToken } : {}),
    }),
    { abortSignal: signal }
  )

  const automationExecutions = (response.AutomationExecutionMetadataList ?? []).map(
    mapAutomationExecutionMetadata
  )
  return {
    automationExecutions,
    nextToken: response.NextToken ?? null,
    count: automationExecutions.length,
  }
}

export async function getAutomationExecution(
  client: SSMClient,
  input: AwsSsmGetAutomationExecutionBody,
  signal?: AbortSignal
) {
  const response = await client.send(
    new GetAutomationExecutionCommand({ AutomationExecutionId: input.automationExecutionId }),
    { abortSignal: signal }
  )

  const execution = response.AutomationExecution

  return {
    automationExecutionId: execution?.AutomationExecutionId ?? '',
    documentName: execution?.DocumentName ?? '',
    documentVersion: execution?.DocumentVersion ?? null,
    automationExecutionStatus: execution?.AutomationExecutionStatus ?? '',
    executionStartTime: isoDate(execution?.ExecutionStartTime),
    executionEndTime: isoDate(execution?.ExecutionEndTime),
    executedBy: execution?.ExecutedBy ?? null,
    mode: execution?.Mode ?? null,
    parentAutomationExecutionId: execution?.ParentAutomationExecutionId ?? null,
    currentStepName: execution?.CurrentStepName ?? null,
    currentAction: execution?.CurrentAction ?? null,
    failureMessage: execution?.FailureMessage ?? null,
    targetParameterName: execution?.TargetParameterName ?? null,
    target: execution?.Target ?? null,
    maxConcurrency: execution?.MaxConcurrency ?? null,
    maxErrors: execution?.MaxErrors ?? null,
    parameters: execution?.Parameters ?? null,
    outputs: execution?.Outputs ?? null,
    stepExecutions: (execution?.StepExecutions ?? []).map(mapStepExecution),
    stepExecutionsTruncated: execution?.StepExecutionsTruncated ?? null,
  }
}

export async function stopAutomationExecution(
  client: SSMClient,
  input: AwsSsmStopAutomationExecutionBody,
  signal?: AbortSignal
) {
  await client.send(
    new StopAutomationExecutionCommand({
      AutomationExecutionId: input.automationExecutionId,
      ...(input.stopType ? { Type: input.stopType } : {}),
    }),
    { abortSignal: signal }
  )

  return {
    message: 'Automation execution stop requested',
    automationExecutionId: input.automationExecutionId,
  }
}

export async function listDocuments(
  client: SSMClient,
  input: AwsSsmListDocumentsBody,
  signal?: AbortSignal
) {
  const response = await client.send(
    new ListDocumentsCommand({
      ...(input.filters?.length ? { Filters: input.filters } : {}),
      ...(input.maxResults != null ? { MaxResults: input.maxResults } : {}),
      ...(input.nextToken ? { NextToken: input.nextToken } : {}),
    }),
    { abortSignal: signal }
  )

  const documents = (response.DocumentIdentifiers ?? []).map(mapDocumentIdentifier)
  return { documents, nextToken: response.NextToken ?? null, count: documents.length }
}

export async function getDocument(
  client: SSMClient,
  input: AwsSsmGetDocumentBody,
  signal?: AbortSignal
) {
  const response = await client.send(
    new GetDocumentCommand({
      Name: input.name,
      ...(input.documentVersion ? { DocumentVersion: input.documentVersion } : {}),
      ...(input.versionName ? { VersionName: input.versionName } : {}),
      ...(input.documentFormat ? { DocumentFormat: input.documentFormat } : {}),
    }),
    { abortSignal: signal }
  )

  return {
    name: response.Name ?? '',
    displayName: response.DisplayName ?? null,
    createdDate: isoDate(response.CreatedDate),
    versionName: response.VersionName ?? null,
    documentVersion: response.DocumentVersion ?? null,
    status: response.Status ?? null,
    statusInformation: response.StatusInformation ?? null,
    content: response.Content ?? '',
    documentType: response.DocumentType ?? null,
    documentFormat: response.DocumentFormat ?? null,
    reviewStatus: response.ReviewStatus ?? null,
  }
}
