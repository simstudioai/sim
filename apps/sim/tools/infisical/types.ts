import type { ToolResponse } from '@/tools/types'

export interface InfisicalListSecretsParams {
  apiKey: string
  baseUrl?: string
  projectId: string
  environment: string
  secretPath?: string
  recursive?: boolean
  expandSecretReferences?: boolean
  viewSecretValue?: boolean
  includeImports?: boolean
  tagSlugs?: string
}

export interface InfisicalGetSecretParams {
  apiKey: string
  baseUrl?: string
  projectId: string
  environment: string
  secretName: string
  secretPath?: string
  version?: number
  type?: string
  viewSecretValue?: boolean
  expandSecretReferences?: boolean
}

export interface InfisicalCreateSecretParams {
  apiKey: string
  baseUrl?: string
  projectId: string
  environment: string
  secretName: string
  secretValue: string
  secretPath?: string
  secretComment?: string
  type?: string
  tagIds?: string
}

export interface InfisicalUpdateSecretParams {
  apiKey: string
  baseUrl?: string
  projectId: string
  environment: string
  secretName: string
  secretValue?: string
  secretPath?: string
  secretComment?: string
  newSecretName?: string
  type?: string
  tagIds?: string
}

export interface InfisicalDeleteSecretParams {
  apiKey: string
  baseUrl?: string
  projectId: string
  environment: string
  secretName: string
  secretPath?: string
  type?: string
}

export interface InfisicalTag {
  id: string
  slug: string
  color: string | null
  name: string
}

export interface InfisicalSecretMetadata {
  key: string
  value: string
}

export interface InfisicalSecret {
  id: string
  workspace: string | null
  secretKey: string
  secretValue: string | null
  secretComment: string | null
  secretPath: string | null
  version: number
  type: string
  environment: string
  tags: InfisicalTag[]
  secretMetadata: InfisicalSecretMetadata[]
  createdAt: string
  updatedAt: string
}

export interface InfisicalListSecretsResponse extends ToolResponse {
  output: {
    secrets: InfisicalSecret[]
    count: number
  }
}

export interface InfisicalGetSecretResponse extends ToolResponse {
  output: {
    secret: InfisicalSecret
  }
}

export interface InfisicalCreateSecretResponse extends ToolResponse {
  output: {
    secret: InfisicalSecret
  }
}

export interface InfisicalUpdateSecretResponse extends ToolResponse {
  output: {
    secret: InfisicalSecret
  }
}

export interface InfisicalDeleteSecretResponse extends ToolResponse {
  output: {
    secret: InfisicalSecret
  }
}

export type InfisicalResponse =
  | InfisicalListSecretsResponse
  | InfisicalGetSecretResponse
  | InfisicalCreateSecretResponse
  | InfisicalUpdateSecretResponse
  | InfisicalDeleteSecretResponse
