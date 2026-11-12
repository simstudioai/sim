import type { ToolResponse } from '@/tools/types'

interface CloudFormationConnectionConfig {
  awsRegion: string
  awsAccessKeyId: string
  awsSecretAccessKey: string
}

export interface CloudFormationDescribeStacksParams extends CloudFormationConnectionConfig {
  stackName?: string
}

export interface CloudFormationListStackResourcesParams extends CloudFormationConnectionConfig {
  stackName: string
}

export interface CloudFormationDetectStackDriftParams extends CloudFormationConnectionConfig {
  stackName: string
}

export interface CloudFormationDescribeStackDriftDetectionStatusParams
  extends CloudFormationConnectionConfig {
  stackDriftDetectionId: string
}

export interface CloudFormationDescribeStackEventsParams extends CloudFormationConnectionConfig {
  stackName: string
  limit?: number
}

export interface CloudFormationGetTemplateParams extends CloudFormationConnectionConfig {
  stackName: string
  templateStage?: 'Original' | 'Processed'
}

export interface CloudFormationValidateTemplateParams extends CloudFormationConnectionConfig {
  templateBody: string
}

interface CloudFormationParameterInput {
  parameterKey: string
  parameterValue?: string
  usePreviousValue?: boolean
}

interface CloudFormationTagInput {
  key: string
  value: string
}

export interface CloudFormationCreateStackParams extends CloudFormationConnectionConfig {
  stackName: string
  templateBody: string
  parameters?: CloudFormationParameterInput[]
  capabilities?: string
  tags?: CloudFormationTagInput[]
  onFailure?: 'ROLLBACK' | 'DELETE' | 'DO_NOTHING'
  timeoutInMinutes?: number
  roleArn?: string
  enableTerminationProtection?: boolean
}

export interface CloudFormationUpdateStackParams extends CloudFormationConnectionConfig {
  stackName: string
  templateBody?: string
  usePreviousTemplate?: boolean
  parameters?: CloudFormationParameterInput[]
  capabilities?: string
  tags?: CloudFormationTagInput[]
  roleArn?: string
}

export interface CloudFormationDeleteStackParams extends CloudFormationConnectionConfig {
  stackName: string
  retainResources?: string
}

export interface CloudFormationCancelUpdateStackParams extends CloudFormationConnectionConfig {
  stackName: string
}

export interface CloudFormationCreateChangeSetParams extends CloudFormationConnectionConfig {
  stackName: string
  changeSetName: string
  templateBody?: string
  usePreviousTemplate?: boolean
  parameters?: CloudFormationParameterInput[]
  capabilities?: string
  changeSetType?: 'CREATE' | 'UPDATE' | 'IMPORT'
  description?: string
  roleArn?: string
  tags?: CloudFormationTagInput[]
}

export interface CloudFormationDescribeChangeSetParams extends CloudFormationConnectionConfig {
  changeSetName: string
  stackName?: string
  nextToken?: string
}

export interface CloudFormationExecuteChangeSetParams extends CloudFormationConnectionConfig {
  changeSetName: string
  stackName?: string
}

export interface CloudFormationGetTemplateSummaryParams extends CloudFormationConnectionConfig {
  templateBody?: string
  stackName?: string
}

interface CloudFormationParameterOutput {
  parameterKey: string
  parameterValue: string | undefined
  usePreviousValue: boolean | undefined
  resolvedValue: string | undefined
}

export interface CloudFormationDescribeStacksResponse extends ToolResponse {
  output: {
    stacks: {
      stackName: string
      stackId: string
      stackStatus: string
      stackStatusReason: string | undefined
      creationTime: number | undefined
      lastUpdatedTime: number | undefined
      description: string | undefined
      enableTerminationProtection: boolean | undefined
      driftInformation: {
        stackDriftStatus: string | undefined
        lastCheckTimestamp: number | undefined
      } | null
      outputs: {
        outputKey: string
        outputValue: string
        description: string | undefined
        exportName?: string
      }[]
      tags: { key: string; value: string }[]
      parameters?: CloudFormationParameterOutput[]
      capabilities?: string[]
      changeSetId?: string
      deletionTime?: number
      disableRollback?: boolean
      notificationArns?: string[]
      timeoutInMinutes?: number
      roleArn?: string
      parentId?: string
      rootId?: string
      detailedStatus?: string
      deletionMode?: string
      retainExceptOnCreate?: boolean
    }[]
  }
}

export interface CloudFormationListStackResourcesResponse extends ToolResponse {
  output: {
    resources: {
      logicalResourceId: string
      physicalResourceId: string | undefined
      resourceType: string
      resourceStatus: string
      resourceStatusReason: string | undefined
      lastUpdatedTimestamp: number | undefined
      driftInformation: {
        stackResourceDriftStatus: string | undefined
        lastCheckTimestamp: number | undefined
      } | null
    }[]
  }
}

export interface CloudFormationDetectStackDriftResponse extends ToolResponse {
  output: {
    stackDriftDetectionId: string
  }
}

export interface CloudFormationDescribeStackDriftDetectionStatusResponse extends ToolResponse {
  output: {
    stackId: string
    stackDriftDetectionId: string
    stackDriftStatus: string | undefined
    detectionStatus: string
    detectionStatusReason: string | undefined
    driftedStackResourceCount: number | undefined
    timestamp: number | undefined
  }
}

export interface CloudFormationDescribeStackEventsResponse extends ToolResponse {
  output: {
    events: {
      stackId: string
      eventId: string
      stackName: string
      logicalResourceId: string | undefined
      physicalResourceId: string | undefined
      resourceType: string | undefined
      resourceStatus: string | undefined
      resourceStatusReason: string | undefined
      timestamp: number | undefined
      operationId?: string
      resourceProperties?: string
      clientRequestToken?: string
      detailedStatus?: string
      hookType?: string
      hookStatus?: string
      hookStatusReason?: string
      hookInvocationPoint?: string
      hookFailureMode?: string
    }[]
  }
}

export interface CloudFormationGetTemplateResponse extends ToolResponse {
  output: {
    templateBody: string
    stagesAvailable: string[]
  }
}

export interface CloudFormationValidateTemplateResponse extends ToolResponse {
  output: {
    description: string | undefined
    parameters: {
      parameterKey: string | undefined
      defaultValue: string | undefined
      noEcho: boolean | undefined
      description: string | undefined
    }[]
    capabilities: string[]
    capabilitiesReason: string | undefined
    declaredTransforms: string[]
  }
}

export interface CloudFormationCreateStackResponse extends ToolResponse {
  output: {
    stackId: string
  }
}

export interface CloudFormationUpdateStackResponse extends ToolResponse {
  output: {
    stackId: string
  }
}

export interface CloudFormationDeleteStackResponse extends ToolResponse {
  output: {
    message: string
  }
}

export interface CloudFormationCancelUpdateStackResponse extends ToolResponse {
  output: {
    message: string
  }
}

export interface CloudFormationCreateChangeSetResponse extends ToolResponse {
  output: {
    changeSetId: string
    stackId: string
  }
}

export interface CloudFormationDescribeChangeSetResponse extends ToolResponse {
  output: {
    changeSetName: string | undefined
    changeSetId: string | undefined
    stackId: string | undefined
    stackName: string | undefined
    description: string | undefined
    executionStatus: string | undefined
    status: string | undefined
    statusReason: string | undefined
    creationTime: number | undefined
    capabilities: string[]
    changes: {
      action: string | undefined
      logicalResourceId: string | undefined
      physicalResourceId: string | undefined
      resourceType: string | undefined
      replacement: string | undefined
      type?: string
      policyAction?: string
      scope?: string[]
      changeSetId?: string
      details?: {
        attribute: string | undefined
        name: string | undefined
        requiresRecreation: string | undefined
        evaluation: string | undefined
        changeSource: string | undefined
        causingEntity: string | undefined
      }[]
    }[]
    parameters?: CloudFormationParameterOutput[]
    tags?: { key: string; value: string }[]
    notificationArns?: string[]
    includeNestedStacks?: boolean
    parentChangeSetId?: string
    rootChangeSetId?: string
    onStackFailure?: string
    importExistingResources?: boolean
    nextToken?: string | null
  }
}

export interface CloudFormationExecuteChangeSetResponse extends ToolResponse {
  output: {
    message: string
  }
}

export interface CloudFormationGetTemplateSummaryResponse extends ToolResponse {
  output: {
    description: string | undefined
    parameters: {
      parameterKey: string | undefined
      defaultValue: string | undefined
      parameterType: string | undefined
      noEcho: boolean | undefined
      description: string | undefined
      allowedValues?: string[]
    }[]
    capabilities: string[]
    capabilitiesReason: string | undefined
    resourceTypes: string[]
    version: string | undefined
    declaredTransforms: string[]
  }
}
