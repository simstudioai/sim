import type { ToolResponse } from '@/tools/types'

export interface CloudFormationConnectionConfig {
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
}

export interface CloudFormationValidateTemplateParams extends CloudFormationConnectionConfig {
  templateBody: string
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
      outputs: { outputKey: string; outputValue: string; description: string | undefined }[]
      tags: { key: string; value: string }[]
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
