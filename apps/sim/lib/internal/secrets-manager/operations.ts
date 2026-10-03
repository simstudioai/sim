import type { AwsSecretsManagerCreateSecretBody } from '@/lib/api/contracts/tools/aws/secrets-manager-create-secret'
import type { AwsSecretsManagerDeleteSecretBody } from '@/lib/api/contracts/tools/aws/secrets-manager-delete-secret'
import type { AwsSecretsManagerDescribeSecretBody } from '@/lib/api/contracts/tools/aws/secrets-manager-describe-secret'
import type { AwsSecretsManagerGetSecretBody } from '@/lib/api/contracts/tools/aws/secrets-manager-get-secret'
import type { AwsSecretsManagerListSecretsBody } from '@/lib/api/contracts/tools/aws/secrets-manager-list-secrets'
import type { AwsSecretsManagerRestoreSecretBody } from '@/lib/api/contracts/tools/aws/secrets-manager-restore-secret'
import type { AwsSecretsManagerRotateSecretBody } from '@/lib/api/contracts/tools/aws/secrets-manager-rotate-secret'
import type { AwsSecretsManagerTagResourceBody } from '@/lib/api/contracts/tools/aws/secrets-manager-tag-resource'
import type { AwsSecretsManagerUntagResourceBody } from '@/lib/api/contracts/tools/aws/secrets-manager-untag-resource'
import type { AwsSecretsManagerUpdateSecretBody } from '@/lib/api/contracts/tools/aws/secrets-manager-update-secret'
import {
  createSecret,
  createSecretsManagerClient,
  deleteSecret,
  describeSecret,
  getSecretValue,
  listSecrets,
  restoreSecret,
  rotateSecret,
  tagResource,
  untagResource,
  updateSecretValue,
} from '@/lib/internal/secrets-manager/client'

export async function executeSecretsManagerGetSecret(
  input: AwsSecretsManagerGetSecretBody,
  signal?: AbortSignal
) {
  const client = createSecretsManagerClient(input)
  try {
    return await getSecretValue(client, input.secretId, input.versionId, input.versionStage, signal)
  } finally {
    client.destroy()
  }
}

export async function executeSecretsManagerListSecrets(
  input: AwsSecretsManagerListSecretsBody,
  signal?: AbortSignal
) {
  const client = createSecretsManagerClient(input)
  try {
    return await listSecrets(client, input.maxResults, input.nextToken, signal)
  } finally {
    client.destroy()
  }
}

export async function executeSecretsManagerCreateSecret(
  input: AwsSecretsManagerCreateSecretBody,
  signal?: AbortSignal
) {
  const client = createSecretsManagerClient(input)
  try {
    const result = await createSecret(
      client,
      input.name,
      input.secretValue,
      input.description,
      signal
    )
    return { message: `Secret "${result.name}" created successfully`, ...result }
  } finally {
    client.destroy()
  }
}

export async function executeSecretsManagerUpdateSecret(
  input: AwsSecretsManagerUpdateSecretBody,
  signal?: AbortSignal
) {
  const client = createSecretsManagerClient(input)
  try {
    const result = await updateSecretValue(
      client,
      input.secretId,
      input.secretValue,
      input.description,
      signal
    )
    return { message: `Secret "${result.name}" updated successfully`, ...result }
  } finally {
    client.destroy()
  }
}

export async function executeSecretsManagerDeleteSecret(
  input: AwsSecretsManagerDeleteSecretBody,
  signal?: AbortSignal
) {
  const client = createSecretsManagerClient(input)
  try {
    const result = await deleteSecret(
      client,
      input.secretId,
      input.recoveryWindowInDays,
      input.forceDelete,
      signal
    )
    const action = input.forceDelete ? 'permanently deleted' : 'scheduled for deletion'
    return { message: `Secret "${result.name}" ${action}`, ...result }
  } finally {
    client.destroy()
  }
}

export async function executeSecretsManagerDescribeSecret(
  input: AwsSecretsManagerDescribeSecretBody,
  signal?: AbortSignal
) {
  const client = createSecretsManagerClient(input)
  try {
    return await describeSecret(client, input.secretId, signal)
  } finally {
    client.destroy()
  }
}

export async function executeSecretsManagerTagResource(
  input: AwsSecretsManagerTagResourceBody,
  signal?: AbortSignal
) {
  const client = createSecretsManagerClient(input)
  try {
    const result = await tagResource(
      client,
      input.secretId,
      input.tags.map((tag) => ({ Key: tag.key, Value: tag.value })),
      signal
    )
    return { message: `Secret "${result.name}" tagged successfully`, ...result }
  } finally {
    client.destroy()
  }
}

export async function executeSecretsManagerUntagResource(
  input: AwsSecretsManagerUntagResourceBody,
  signal?: AbortSignal
) {
  const client = createSecretsManagerClient(input)
  try {
    const result = await untagResource(client, input.secretId, input.tagKeys, signal)
    return { message: `Secret "${result.name}" untagged successfully`, ...result }
  } finally {
    client.destroy()
  }
}

export async function executeSecretsManagerRestoreSecret(
  input: AwsSecretsManagerRestoreSecretBody,
  signal?: AbortSignal
) {
  const client = createSecretsManagerClient(input)
  try {
    const result = await restoreSecret(client, input.secretId, signal)
    return { message: `Secret "${result.name}" restored successfully`, ...result }
  } finally {
    client.destroy()
  }
}

export async function executeSecretsManagerRotateSecret(
  input: AwsSecretsManagerRotateSecretBody,
  signal?: AbortSignal
) {
  const client = createSecretsManagerClient(input)
  try {
    const result = await rotateSecret(
      client,
      input.secretId,
      input.clientRequestToken,
      input.rotationLambdaARN,
      {
        automaticallyAfterDays: input.automaticallyAfterDays,
        duration: input.duration,
        scheduleExpression: input.scheduleExpression,
      },
      input.rotateImmediately,
      signal
    )
    return { message: `Rotation started for secret "${result.name}"`, ...result }
  } finally {
    client.destroy()
  }
}
