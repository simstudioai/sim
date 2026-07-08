import type { ToolResponse } from '@/tools/types'

export interface SecretsManagerConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export interface SecretsManagerGetSecretParams extends SecretsManagerConnectionConfig {
  secretId: string
  versionId?: string | null
  versionStage?: string | null
}

export interface SecretsManagerListSecretsParams extends SecretsManagerConnectionConfig {
  maxResults?: number | null
  nextToken?: string | null
}

export interface SecretsManagerCreateSecretParams extends SecretsManagerConnectionConfig {
  name: string
  secretValue: string
  description?: string | null
}

export interface SecretsManagerUpdateSecretParams extends SecretsManagerConnectionConfig {
  secretId: string
  secretValue: string
  description?: string | null
}

export interface SecretsManagerDeleteSecretParams extends SecretsManagerConnectionConfig {
  secretId: string
  recoveryWindowInDays?: number | null
  forceDelete?: boolean | null
}

export interface SecretsManagerBaseResponse extends ToolResponse {
  output: { message: string }
  error?: string
}

export interface SecretsManagerGetSecretResponse extends ToolResponse {
  output: {
    name: string
    secretValue: string
    arn: string
    versionId: string
    versionStages: string[]
    createdDate: string | null
  }
  error?: string
}

export interface SecretsManagerRotationRules {
  automaticallyAfterDays: number | null
  duration: string | null
  scheduleExpression: string | null
}

export interface SecretsManagerListSecretsResponse extends ToolResponse {
  output: {
    secrets: Array<{
      name: string
      arn: string
      description: string | null
      createdDate: string | null
      lastChangedDate: string | null
      lastAccessedDate: string | null
      rotationEnabled: boolean
      tags: Array<{ key: string; value: string }>
      rotationRules: SecretsManagerRotationRules | null
      lastRotatedDate: string | null
      nextRotationDate: string | null
      deletedDate: string | null
      secretVersionsToStages: Record<string, string[]> | null
    }>
    nextToken: string | null
    count: number
  }
  error?: string
}

export interface SecretsManagerCreateSecretResponse extends ToolResponse {
  output: {
    message: string
    name: string
    arn: string
    versionId: string
  }
  error?: string
}

export interface SecretsManagerUpdateSecretResponse extends ToolResponse {
  output: {
    message: string
    name: string
    arn: string
    versionId: string
  }
  error?: string
}

export interface SecretsManagerDeleteSecretResponse extends ToolResponse {
  output: {
    message: string
    name: string
    arn: string
    deletionDate: string | null
  }
  error?: string
}

export interface SecretsManagerDescribeSecretParams extends SecretsManagerConnectionConfig {
  secretId: string
}

export interface SecretsManagerReplicationStatus {
  region: string
  kmsKeyId: string | null
  status: string | null
  statusMessage: string | null
  lastAccessedDate: string | null
}

export interface SecretsManagerDescribeSecretResponse extends ToolResponse {
  output: {
    name: string
    arn: string
    description: string | null
    kmsKeyId: string | null
    rotationEnabled: boolean
    rotationLambdaARN: string | null
    rotationRules: SecretsManagerRotationRules | null
    lastRotatedDate: string | null
    lastChangedDate: string | null
    lastAccessedDate: string | null
    deletedDate: string | null
    nextRotationDate: string | null
    tags: Array<{ key: string; value: string }>
    versionIdsToStages: Record<string, string[]> | null
    owningService: string | null
    createdDate: string | null
    primaryRegion: string | null
    replicationStatus: SecretsManagerReplicationStatus[]
  }
  error?: string
}

export interface SecretsManagerTagResourceParams extends SecretsManagerConnectionConfig {
  secretId: string
  tags: Array<{ key: string; value: string }>
}

export interface SecretsManagerTagResourceResponse extends ToolResponse {
  output: {
    message: string
    name: string
  }
  error?: string
}

export interface SecretsManagerUntagResourceParams extends SecretsManagerConnectionConfig {
  secretId: string
  tagKeys: string[]
}

export interface SecretsManagerUntagResourceResponse extends ToolResponse {
  output: {
    message: string
    name: string
  }
  error?: string
}

export interface SecretsManagerRestoreSecretParams extends SecretsManagerConnectionConfig {
  secretId: string
}

export interface SecretsManagerRestoreSecretResponse extends ToolResponse {
  output: {
    message: string
    name: string
    arn: string
  }
  error?: string
}

export interface SecretsManagerRotateSecretParams extends SecretsManagerConnectionConfig {
  secretId: string
  clientRequestToken?: string | null
  rotationLambdaARN?: string | null
  automaticallyAfterDays?: number | null
  duration?: string | null
  scheduleExpression?: string | null
  rotateImmediately?: boolean | null
}

export interface SecretsManagerRotateSecretResponse extends ToolResponse {
  output: {
    message: string
    name: string
    arn: string
    versionId: string
  }
  error?: string
}
