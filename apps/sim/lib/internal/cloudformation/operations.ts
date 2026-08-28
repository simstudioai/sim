import {
  CancelUpdateStackCommand,
  CreateChangeSetCommand,
  CreateStackCommand,
  DeleteStackCommand,
  DescribeChangeSetCommand,
  DescribeStackDriftDetectionStatusCommand,
  DescribeStackEventsCommand,
  DescribeStacksCommand,
  DetectStackDriftCommand,
  ExecuteChangeSetCommand,
  GetTemplateCommand,
  GetTemplateSummaryCommand,
  ListStackResourcesCommand,
  type Stack,
  type StackEvent,
  type StackResourceSummary,
  UpdateStackCommand,
  ValidateTemplateCommand,
} from '@aws-sdk/client-cloudformation'
import type { AwsCloudformationCancelUpdateStackBody } from '@/lib/api/contracts/tools/aws/cloudformation-cancel-update-stack'
import type { AwsCloudformationCreateChangeSetBody } from '@/lib/api/contracts/tools/aws/cloudformation-create-change-set'
import type { AwsCloudformationCreateStackBody } from '@/lib/api/contracts/tools/aws/cloudformation-create-stack'
import type { AwsCloudformationDeleteStackBody } from '@/lib/api/contracts/tools/aws/cloudformation-delete-stack'
import type { AwsCloudformationDescribeChangeSetBody } from '@/lib/api/contracts/tools/aws/cloudformation-describe-change-set'
import type { AwsCloudformationDescribeStackDriftDetectionStatusBody } from '@/lib/api/contracts/tools/aws/cloudformation-describe-stack-drift-detection-status'
import type { AwsCloudformationDescribeStackEventsBody } from '@/lib/api/contracts/tools/aws/cloudformation-describe-stack-events'
import type { AwsCloudformationDescribeStacksBody } from '@/lib/api/contracts/tools/aws/cloudformation-describe-stacks'
import type { AwsCloudformationDetectStackDriftBody } from '@/lib/api/contracts/tools/aws/cloudformation-detect-stack-drift'
import type { AwsCloudformationExecuteChangeSetBody } from '@/lib/api/contracts/tools/aws/cloudformation-execute-change-set'
import type { AwsCloudformationGetTemplateBody } from '@/lib/api/contracts/tools/aws/cloudformation-get-template'
import type { AwsCloudformationGetTemplateSummaryBody } from '@/lib/api/contracts/tools/aws/cloudformation-get-template-summary'
import type { AwsCloudformationListStackResourcesBody } from '@/lib/api/contracts/tools/aws/cloudformation-list-stack-resources'
import type { AwsCloudformationUpdateStackBody } from '@/lib/api/contracts/tools/aws/cloudformation-update-stack'
import type { AwsCloudformationValidateTemplateBody } from '@/lib/api/contracts/tools/aws/cloudformation-validate-template'
import {
  createCloudFormationClient,
  parseCapabilities,
  toStackParameters,
  toStackTags,
} from '@/lib/internal/cloudformation/client'

export async function executeCloudformationCancelUpdateStack(
  input: AwsCloudformationCancelUpdateStackBody,
  signal?: AbortSignal
) {
  const client = createCloudFormationClient(input)
  try {
    await client.send(new CancelUpdateStackCommand({ StackName: input.stackName }), {
      abortSignal: signal,
    })
    return {
      success: true,
      output: {
        message: `Update for stack "${input.stackName}" is being cancelled and rolled back`,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeCloudformationCreateChangeSet(
  input: AwsCloudformationCreateChangeSetBody,
  signal?: AbortSignal
) {
  const client = createCloudFormationClient(input)
  try {
    const response = await client.send(
      new CreateChangeSetCommand({
        StackName: input.stackName,
        ChangeSetName: input.changeSetName,
        TemplateBody: input.templateBody,
        UsePreviousTemplate: input.usePreviousTemplate,
        Parameters: toStackParameters(input.parameters),
        Capabilities: parseCapabilities(input.capabilities),
        ChangeSetType: input.changeSetType,
        Description: input.description,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        changeSetId: response.Id ?? '',
        stackId: response.StackId ?? '',
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeCloudformationCreateStack(
  input: AwsCloudformationCreateStackBody,
  signal?: AbortSignal
) {
  const client = createCloudFormationClient(input)
  try {
    const response = await client.send(
      new CreateStackCommand({
        StackName: input.stackName,
        TemplateBody: input.templateBody,
        Parameters: toStackParameters(input.parameters),
        Capabilities: parseCapabilities(input.capabilities),
        Tags: toStackTags(input.tags),
        OnFailure: input.onFailure,
        TimeoutInMinutes: input.timeoutInMinutes,
      }),
      { abortSignal: signal }
    )
    return { success: true, output: { stackId: response.StackId ?? '' } }
  } finally {
    client.destroy()
  }
}

export async function executeCloudformationDeleteStack(
  input: AwsCloudformationDeleteStackBody,
  signal?: AbortSignal
) {
  const client = createCloudFormationClient(input)
  try {
    const retainResources = input.retainResources
      ?.split(',')
      .map((resource) => resource.trim())
      .filter(Boolean)
    await client.send(
      new DeleteStackCommand({
        StackName: input.stackName,
        ...(retainResources && retainResources.length > 0
          ? { RetainResources: retainResources }
          : {}),
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: { message: `Deletion of stack "${input.stackName}" has been initiated` },
    }
  } finally {
    client.destroy()
  }
}

export async function executeCloudformationDescribeChangeSet(
  input: AwsCloudformationDescribeChangeSetBody,
  signal?: AbortSignal
) {
  const client = createCloudFormationClient(input)
  try {
    const response = await client.send(
      new DescribeChangeSetCommand({
        ChangeSetName: input.changeSetName,
        ...(input.stackName ? { StackName: input.stackName } : {}),
      }),
      { abortSignal: signal }
    )
    const changes = (response.Changes ?? []).map((change) => ({
      action: change.ResourceChange?.Action,
      logicalResourceId: change.ResourceChange?.LogicalResourceId,
      physicalResourceId: change.ResourceChange?.PhysicalResourceId,
      resourceType: change.ResourceChange?.ResourceType,
      replacement: change.ResourceChange?.Replacement,
    }))
    return {
      success: true,
      output: {
        changeSetName: response.ChangeSetName,
        changeSetId: response.ChangeSetId,
        stackId: response.StackId,
        stackName: response.StackName,
        description: response.Description,
        executionStatus: response.ExecutionStatus,
        status: response.Status,
        statusReason: response.StatusReason,
        creationTime: response.CreationTime?.getTime(),
        capabilities: response.Capabilities ?? [],
        changes,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeCloudformationDescribeStackDriftDetectionStatus(
  input: AwsCloudformationDescribeStackDriftDetectionStatusBody,
  signal?: AbortSignal
) {
  const client = createCloudFormationClient(input)
  try {
    const response = await client.send(
      new DescribeStackDriftDetectionStatusCommand({
        StackDriftDetectionId: input.stackDriftDetectionId,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        stackId: response.StackId ?? '',
        stackDriftDetectionId: response.StackDriftDetectionId ?? '',
        stackDriftStatus: response.StackDriftStatus,
        detectionStatus: response.DetectionStatus ?? 'UNKNOWN',
        detectionStatusReason: response.DetectionStatusReason,
        driftedStackResourceCount: response.DriftedStackResourceCount,
        timestamp: response.Timestamp?.getTime(),
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeCloudformationDescribeStackEvents(
  input: AwsCloudformationDescribeStackEventsBody,
  signal?: AbortSignal
) {
  const client = createCloudFormationClient(input)
  try {
    const limit = input.limit ?? 50
    const allEvents: StackEvent[] = []
    let nextToken: string | undefined
    do {
      const response = await client.send(
        new DescribeStackEventsCommand({
          StackName: input.stackName,
          ...(nextToken ? { NextToken: nextToken } : {}),
        }),
        { abortSignal: signal }
      )
      allEvents.push(...(response.StackEvents ?? []))
      nextToken = allEvents.length >= limit ? undefined : response.NextToken
    } while (nextToken)

    const events = allEvents.slice(0, limit).map((event) => ({
      stackId: event.StackId ?? '',
      eventId: event.EventId ?? '',
      stackName: event.StackName ?? '',
      logicalResourceId: event.LogicalResourceId,
      physicalResourceId: event.PhysicalResourceId,
      resourceType: event.ResourceType,
      resourceStatus: event.ResourceStatus,
      resourceStatusReason: event.ResourceStatusReason,
      timestamp: event.Timestamp?.getTime(),
    }))
    return { success: true, output: { events } }
  } finally {
    client.destroy()
  }
}

export async function executeCloudformationDescribeStacks(
  input: AwsCloudformationDescribeStacksBody,
  signal?: AbortSignal
) {
  const client = createCloudFormationClient(input)
  try {
    const allStacks: Stack[] = []
    let nextToken: string | undefined
    do {
      const response = await client.send(
        new DescribeStacksCommand({
          ...(input.stackName ? { StackName: input.stackName } : {}),
          ...(nextToken ? { NextToken: nextToken } : {}),
        }),
        { abortSignal: signal }
      )
      allStacks.push(...(response.Stacks ?? []))
      nextToken = response.NextToken
    } while (nextToken)

    const stacks = allStacks.map((stack) => ({
      stackName: stack.StackName ?? '',
      stackId: stack.StackId ?? '',
      stackStatus: stack.StackStatus ?? 'UNKNOWN',
      stackStatusReason: stack.StackStatusReason,
      creationTime: stack.CreationTime?.getTime(),
      lastUpdatedTime: stack.LastUpdatedTime?.getTime(),
      description: stack.Description,
      enableTerminationProtection: stack.EnableTerminationProtection,
      driftInformation: stack.DriftInformation
        ? {
            stackDriftStatus: stack.DriftInformation.StackDriftStatus,
            lastCheckTimestamp: stack.DriftInformation.LastCheckTimestamp?.getTime(),
          }
        : null,
      outputs: (stack.Outputs ?? []).map((output) => ({
        outputKey: output.OutputKey ?? '',
        outputValue: output.OutputValue ?? '',
        description: output.Description,
      })),
      tags: (stack.Tags ?? []).map((tag) => ({ key: tag.Key ?? '', value: tag.Value ?? '' })),
    }))
    return { success: true, output: { stacks } }
  } finally {
    client.destroy()
  }
}

export async function executeCloudformationDetectStackDrift(
  input: AwsCloudformationDetectStackDriftBody,
  signal?: AbortSignal
) {
  const client = createCloudFormationClient(input)
  try {
    const response = await client.send(
      new DetectStackDriftCommand({ StackName: input.stackName }),
      {
        abortSignal: signal,
      }
    )
    if (!response.StackDriftDetectionId) throw new Error('No drift detection ID returned')
    return {
      success: true,
      output: { stackDriftDetectionId: response.StackDriftDetectionId },
    }
  } finally {
    client.destroy()
  }
}

export async function executeCloudformationExecuteChangeSet(
  input: AwsCloudformationExecuteChangeSetBody,
  signal?: AbortSignal
) {
  const client = createCloudFormationClient(input)
  try {
    await client.send(
      new ExecuteChangeSetCommand({
        ChangeSetName: input.changeSetName,
        ...(input.stackName ? { StackName: input.stackName } : {}),
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: { message: `Change set "${input.changeSetName}" execution has been initiated` },
    }
  } finally {
    client.destroy()
  }
}

export async function executeCloudformationGetTemplateSummary(
  input: AwsCloudformationGetTemplateSummaryBody,
  signal?: AbortSignal
) {
  const client = createCloudFormationClient(input)
  try {
    const response = await client.send(
      new GetTemplateSummaryCommand({
        ...(input.templateBody ? { TemplateBody: input.templateBody } : {}),
        ...(input.stackName ? { StackName: input.stackName } : {}),
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        description: response.Description,
        parameters: (response.Parameters ?? []).map((parameter) => ({
          parameterKey: parameter.ParameterKey,
          defaultValue: parameter.DefaultValue,
          parameterType: parameter.ParameterType,
          noEcho: parameter.NoEcho,
          description: parameter.Description,
        })),
        capabilities: response.Capabilities ?? [],
        capabilitiesReason: response.CapabilitiesReason,
        resourceTypes: response.ResourceTypes ?? [],
        version: response.Version,
        declaredTransforms: response.DeclaredTransforms ?? [],
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeCloudformationGetTemplate(
  input: AwsCloudformationGetTemplateBody,
  signal?: AbortSignal
) {
  const client = createCloudFormationClient(input)
  try {
    const response = await client.send(
      new GetTemplateCommand({
        StackName: input.stackName,
        ...(input.templateStage ? { TemplateStage: input.templateStage } : {}),
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        templateBody: response.TemplateBody ?? '',
        stagesAvailable: response.StagesAvailable ?? [],
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeCloudformationListStackResources(
  input: AwsCloudformationListStackResourcesBody,
  signal?: AbortSignal
) {
  const client = createCloudFormationClient(input)
  try {
    const allSummaries: StackResourceSummary[] = []
    let nextToken: string | undefined
    do {
      const response = await client.send(
        new ListStackResourcesCommand({
          StackName: input.stackName,
          ...(nextToken ? { NextToken: nextToken } : {}),
        }),
        { abortSignal: signal }
      )
      allSummaries.push(...(response.StackResourceSummaries ?? []))
      nextToken = response.NextToken
    } while (nextToken)

    const resources = allSummaries.map((resource) => ({
      logicalResourceId: resource.LogicalResourceId ?? '',
      physicalResourceId: resource.PhysicalResourceId,
      resourceType: resource.ResourceType ?? '',
      resourceStatus: resource.ResourceStatus ?? 'UNKNOWN',
      resourceStatusReason: resource.ResourceStatusReason,
      lastUpdatedTimestamp: resource.LastUpdatedTimestamp?.getTime(),
      driftInformation: resource.DriftInformation
        ? {
            stackResourceDriftStatus: resource.DriftInformation.StackResourceDriftStatus,
            lastCheckTimestamp: resource.DriftInformation.LastCheckTimestamp?.getTime(),
          }
        : null,
    }))
    return { success: true, output: { resources } }
  } finally {
    client.destroy()
  }
}

export async function executeCloudformationUpdateStack(
  input: AwsCloudformationUpdateStackBody,
  signal?: AbortSignal
) {
  const client = createCloudFormationClient(input)
  try {
    const response = await client.send(
      new UpdateStackCommand({
        StackName: input.stackName,
        TemplateBody: input.templateBody,
        UsePreviousTemplate: input.usePreviousTemplate,
        Parameters: toStackParameters(input.parameters),
        Capabilities: parseCapabilities(input.capabilities),
        Tags: toStackTags(input.tags),
      }),
      { abortSignal: signal }
    )
    return { success: true, output: { stackId: response.StackId ?? '' } }
  } finally {
    client.destroy()
  }
}

export async function executeCloudformationValidateTemplate(
  input: AwsCloudformationValidateTemplateBody,
  signal?: AbortSignal
) {
  const client = createCloudFormationClient(input)
  try {
    const response = await client.send(
      new ValidateTemplateCommand({ TemplateBody: input.templateBody }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        description: response.Description,
        parameters: (response.Parameters ?? []).map((parameter) => ({
          parameterKey: parameter.ParameterKey,
          defaultValue: parameter.DefaultValue,
          noEcho: parameter.NoEcho,
          description: parameter.Description,
        })),
        capabilities: response.Capabilities ?? [],
        capabilitiesReason: response.CapabilitiesReason,
        declaredTransforms: response.DeclaredTransforms ?? [],
      },
    }
  } finally {
    client.destroy()
  }
}
