import {
  AssumeRoleCommand,
  GetAccessKeyInfoCommand,
  GetCallerIdentityCommand,
  GetSessionTokenCommand,
  STSClient,
} from '@aws-sdk/client-sts'
import type { STSConnectionConfig } from '@/tools/sts/types'

export function createSTSClient(config: STSConnectionConfig): STSClient {
  return new STSClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

export async function assumeRole(
  client: STSClient,
  roleArn: string,
  roleSessionName: string,
  durationSeconds?: number | null,
  externalId?: string | null,
  serialNumber?: string | null,
  tokenCode?: string | null
) {
  const command = new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: roleSessionName,
    ...(durationSeconds ? { DurationSeconds: durationSeconds } : {}),
    ...(externalId ? { ExternalId: externalId } : {}),
    ...(serialNumber ? { SerialNumber: serialNumber } : {}),
    ...(tokenCode ? { TokenCode: tokenCode } : {}),
  })

  const response = await client.send(command)

  return {
    accessKeyId: response.Credentials?.AccessKeyId ?? '',
    secretAccessKey: response.Credentials?.SecretAccessKey ?? '',
    sessionToken: response.Credentials?.SessionToken ?? '',
    expiration: response.Credentials?.Expiration?.toISOString() ?? null,
    assumedRoleArn: response.AssumedRoleUser?.Arn ?? '',
    assumedRoleId: response.AssumedRoleUser?.AssumedRoleId ?? '',
    packedPolicySize: response.PackedPolicySize ?? null,
  }
}

export async function getCallerIdentity(client: STSClient) {
  const command = new GetCallerIdentityCommand({})
  const response = await client.send(command)

  return {
    account: response.Account ?? '',
    arn: response.Arn ?? '',
    userId: response.UserId ?? '',
  }
}

export async function getSessionToken(
  client: STSClient,
  durationSeconds?: number | null,
  serialNumber?: string | null,
  tokenCode?: string | null
) {
  const command = new GetSessionTokenCommand({
    ...(durationSeconds ? { DurationSeconds: durationSeconds } : {}),
    ...(serialNumber ? { SerialNumber: serialNumber } : {}),
    ...(tokenCode ? { TokenCode: tokenCode } : {}),
  })

  const response = await client.send(command)

  return {
    accessKeyId: response.Credentials?.AccessKeyId ?? '',
    secretAccessKey: response.Credentials?.SecretAccessKey ?? '',
    sessionToken: response.Credentials?.SessionToken ?? '',
    expiration: response.Credentials?.Expiration?.toISOString() ?? null,
  }
}

export async function getAccessKeyInfo(client: STSClient, accessKeyId: string) {
  const command = new GetAccessKeyInfoCommand({
    AccessKeyId: accessKeyId,
  })

  const response = await client.send(command)

  return {
    account: response.Account ?? '',
  }
}
