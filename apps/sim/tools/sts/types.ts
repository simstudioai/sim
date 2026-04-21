import type { ToolResponse } from '@/tools/types'

export interface STSConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export interface STSAssumeRoleParams extends STSConnectionConfig {
  roleArn: string
  roleSessionName: string
  durationSeconds?: number | null
  externalId?: string | null
  serialNumber?: string | null
  tokenCode?: string | null
}

export interface STSGetCallerIdentityParams extends STSConnectionConfig {}

export interface STSGetSessionTokenParams extends STSConnectionConfig {
  durationSeconds?: number | null
  serialNumber?: string | null
  tokenCode?: string | null
}

export interface STSGetAccessKeyInfoParams extends STSConnectionConfig {
  targetAccessKeyId: string
}

export interface STSAssumeRoleResponse extends ToolResponse {
  output: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken: string
    expiration: string | null
    assumedRoleArn: string
    assumedRoleId: string
    packedPolicySize: number | null
  }
}

export interface STSGetCallerIdentityResponse extends ToolResponse {
  output: {
    account: string
    arn: string
    userId: string
  }
}

export interface STSGetSessionTokenResponse extends ToolResponse {
  output: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken: string
    expiration: string | null
  }
}

export interface STSGetAccessKeyInfoResponse extends ToolResponse {
  output: {
    account: string
  }
}

export interface STSBaseResponse extends ToolResponse {
  output: { message: string }
}
