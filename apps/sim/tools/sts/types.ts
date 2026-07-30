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
  policy?: string | null
  externalId?: string | null
  serialNumber?: string | null
  tokenCode?: string | null
  policyArns?: string | null
  tags?: string | null
  transitiveTagKeys?: string | null
}

export interface STSAssumeRoleWithWebIdentityParams {
  region: string
  roleArn: string
  roleSessionName: string
  webIdentityToken: string
  providerId?: string | null
  policyArns?: string | null
  policy?: string | null
  durationSeconds?: number | null
}

export interface STSAssumeRoleWithSAMLParams {
  region: string
  roleArn: string
  principalArn: string
  samlAssertion: string
  policyArns?: string | null
  policy?: string | null
  durationSeconds?: number | null
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
    sourceIdentity: string | null
  }
}

export interface STSAssumeRoleWithWebIdentityResponse extends ToolResponse {
  output: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken: string
    expiration: string | null
    assumedRoleArn: string
    assumedRoleId: string
    subjectFromWebIdentityToken: string
    audience: string | null
    provider: string | null
    packedPolicySize: number | null
    sourceIdentity: string | null
  }
}

export interface STSAssumeRoleWithSAMLResponse extends ToolResponse {
  output: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken: string
    expiration: string | null
    assumedRoleArn: string
    assumedRoleId: string
    subject: string | null
    subjectType: string | null
    issuer: string | null
    audience: string | null
    nameQualifier: string | null
    packedPolicySize: number | null
    sourceIdentity: string | null
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
