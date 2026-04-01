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
