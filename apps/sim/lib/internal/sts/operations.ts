import {
  assumeRole,
  assumeRoleWithSAML,
  assumeRoleWithWebIdentity,
  createSTSClient,
  createUnauthenticatedSTSClient,
  getAccessKeyInfo,
  getCallerIdentity,
  getSessionToken,
} from '@/lib/internal/sts/client'
import type {
  StsAssumeRoleInput,
  StsAssumeRoleWithSamlInput,
  StsAssumeRoleWithWebIdentityInput,
  StsGetAccessKeyInfoInput,
  StsGetCallerIdentityInput,
  StsGetSessionTokenInput,
} from '@/lib/internal/sts/schema'

export async function executeStsAssumeRole(input: StsAssumeRoleInput, signal?: AbortSignal) {
  const client = createSTSClient(input)
  try {
    return await assumeRole(
      client,
      input.roleArn,
      input.roleSessionName,
      input.durationSeconds,
      input.policy,
      input.externalId,
      input.serialNumber,
      input.tokenCode,
      input.policyArns,
      input.tags,
      input.transitiveTagKeys,
      signal
    )
  } finally {
    client.destroy()
  }
}

export async function executeStsAssumeRoleWithWebIdentity(
  input: StsAssumeRoleWithWebIdentityInput,
  signal?: AbortSignal
) {
  const client = createUnauthenticatedSTSClient(input.region)
  try {
    return await assumeRoleWithWebIdentity(
      client,
      input.roleArn,
      input.roleSessionName,
      input.webIdentityToken,
      input.providerId,
      input.policyArns,
      input.policy,
      input.durationSeconds,
      signal
    )
  } finally {
    client.destroy()
  }
}

export async function executeStsAssumeRoleWithSAML(
  input: StsAssumeRoleWithSamlInput,
  signal?: AbortSignal
) {
  const client = createUnauthenticatedSTSClient(input.region)
  try {
    return await assumeRoleWithSAML(
      client,
      input.roleArn,
      input.principalArn,
      input.samlAssertion,
      input.policyArns,
      input.policy,
      input.durationSeconds,
      signal
    )
  } finally {
    client.destroy()
  }
}

export async function executeStsGetCallerIdentity(
  input: StsGetCallerIdentityInput,
  signal?: AbortSignal
) {
  const client = createSTSClient(input)
  try {
    return await getCallerIdentity(client, signal)
  } finally {
    client.destroy()
  }
}

export async function executeStsGetSessionToken(
  input: StsGetSessionTokenInput,
  signal?: AbortSignal
) {
  const client = createSTSClient(input)
  try {
    return await getSessionToken(
      client,
      input.durationSeconds,
      input.serialNumber,
      input.tokenCode,
      signal
    )
  } finally {
    client.destroy()
  }
}

export async function executeStsGetAccessKeyInfo(
  input: StsGetAccessKeyInfoInput,
  signal?: AbortSignal
) {
  const client = createSTSClient(input)
  try {
    return await getAccessKeyInfo(client, input.targetAccessKeyId, signal)
  } finally {
    client.destroy()
  }
}
