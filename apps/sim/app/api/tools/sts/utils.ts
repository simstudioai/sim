import {
  AssumeRoleCommand,
  AssumeRoleWithSAMLCommand,
  AssumeRoleWithWebIdentityCommand,
  GetAccessKeyInfoCommand,
  GetCallerIdentityCommand,
  GetSessionTokenCommand,
  type PolicyDescriptorType,
  STSClient,
  type Tag,
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

/**
 * Creates an STS client with no static credentials attached. Used for
 * AssumeRoleWithWebIdentity / AssumeRoleWithSAML, which are unsigned calls
 * that authenticate the caller via the supplied token/assertion rather than
 * AWS IAM credentials.
 */
export function createUnauthenticatedSTSClient(region: string): STSClient {
  return new STSClient({ region })
}

function parsePolicyArns(policyArns?: string | null): PolicyDescriptorType[] | undefined {
  if (!policyArns) return undefined
  const arns = policyArns
    .split(',')
    .map((arn) => arn.trim())
    .filter((arn) => arn.length > 0)
  return arns.length > 0 ? arns.map((arn) => ({ arn })) : undefined
}

function parseTags(tags?: string | null): Tag[] | undefined {
  if (!tags) return undefined
  const parsed = JSON.parse(tags) as Record<string, string>
  const entries = Object.entries(parsed)
  return entries.length > 0
    ? entries.map(([Key, Value]) => ({ Key, Value: String(Value) }))
    : undefined
}

function parseTransitiveTagKeys(transitiveTagKeys?: string | null): string[] | undefined {
  if (!transitiveTagKeys) return undefined
  const keys = transitiveTagKeys
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
  return keys.length > 0 ? keys : undefined
}

export async function assumeRole(
  client: STSClient,
  roleArn: string,
  roleSessionName: string,
  durationSeconds?: number | null,
  policy?: string | null,
  externalId?: string | null,
  serialNumber?: string | null,
  tokenCode?: string | null,
  policyArns?: string | null,
  tags?: string | null,
  transitiveTagKeys?: string | null
) {
  const command = new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: roleSessionName,
    ...(durationSeconds ? { DurationSeconds: durationSeconds } : {}),
    ...(policy ? { Policy: policy } : {}),
    ...(externalId ? { ExternalId: externalId } : {}),
    ...(serialNumber ? { SerialNumber: serialNumber } : {}),
    ...(tokenCode ? { TokenCode: tokenCode } : {}),
    ...(() => {
      const arns = parsePolicyArns(policyArns)
      return arns ? { PolicyArns: arns } : {}
    })(),
    ...(() => {
      const sessionTags = parseTags(tags)
      return sessionTags ? { Tags: sessionTags } : {}
    })(),
    ...(() => {
      const keys = parseTransitiveTagKeys(transitiveTagKeys)
      return keys ? { TransitiveTagKeys: keys } : {}
    })(),
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
    sourceIdentity: response.SourceIdentity ?? null,
  }
}

export async function assumeRoleWithWebIdentity(
  client: STSClient,
  roleArn: string,
  roleSessionName: string,
  webIdentityToken: string,
  providerId?: string | null,
  policyArns?: string | null,
  policy?: string | null,
  durationSeconds?: number | null
) {
  const command = new AssumeRoleWithWebIdentityCommand({
    RoleArn: roleArn,
    RoleSessionName: roleSessionName,
    WebIdentityToken: webIdentityToken,
    ...(providerId ? { ProviderId: providerId } : {}),
    ...(policy ? { Policy: policy } : {}),
    ...(durationSeconds ? { DurationSeconds: durationSeconds } : {}),
    ...(() => {
      const arns = parsePolicyArns(policyArns)
      return arns ? { PolicyArns: arns } : {}
    })(),
  })

  const response = await client.send(command)

  return {
    accessKeyId: response.Credentials?.AccessKeyId ?? '',
    secretAccessKey: response.Credentials?.SecretAccessKey ?? '',
    sessionToken: response.Credentials?.SessionToken ?? '',
    expiration: response.Credentials?.Expiration?.toISOString() ?? null,
    assumedRoleArn: response.AssumedRoleUser?.Arn ?? '',
    assumedRoleId: response.AssumedRoleUser?.AssumedRoleId ?? '',
    subjectFromWebIdentityToken: response.SubjectFromWebIdentityToken ?? '',
    audience: response.Audience ?? null,
    provider: response.Provider ?? null,
    packedPolicySize: response.PackedPolicySize ?? null,
    sourceIdentity: response.SourceIdentity ?? null,
  }
}

export async function assumeRoleWithSAML(
  client: STSClient,
  roleArn: string,
  principalArn: string,
  samlAssertion: string,
  policyArns?: string | null,
  policy?: string | null,
  durationSeconds?: number | null
) {
  const command = new AssumeRoleWithSAMLCommand({
    RoleArn: roleArn,
    PrincipalArn: principalArn,
    SAMLAssertion: samlAssertion,
    ...(policy ? { Policy: policy } : {}),
    ...(durationSeconds ? { DurationSeconds: durationSeconds } : {}),
    ...(() => {
      const arns = parsePolicyArns(policyArns)
      return arns ? { PolicyArns: arns } : {}
    })(),
  })

  const response = await client.send(command)

  return {
    accessKeyId: response.Credentials?.AccessKeyId ?? '',
    secretAccessKey: response.Credentials?.SecretAccessKey ?? '',
    sessionToken: response.Credentials?.SessionToken ?? '',
    expiration: response.Credentials?.Expiration?.toISOString() ?? null,
    assumedRoleArn: response.AssumedRoleUser?.Arn ?? '',
    assumedRoleId: response.AssumedRoleUser?.AssumedRoleId ?? '',
    subject: response.Subject ?? null,
    subjectType: response.SubjectType ?? null,
    issuer: response.Issuer ?? null,
    audience: response.Audience ?? null,
    nameQualifier: response.NameQualifier ?? null,
    packedPolicySize: response.PackedPolicySize ?? null,
    sourceIdentity: response.SourceIdentity ?? null,
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
