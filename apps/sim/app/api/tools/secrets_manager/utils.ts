import type { SecretListEntry, Tag } from '@aws-sdk/client-secrets-manager'
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  ListSecretsCommand,
  SecretsManagerClient,
  UpdateSecretCommand,
} from '@aws-sdk/client-secrets-manager'
import type { SecretsManagerConnectionConfig } from '@/tools/secrets_manager/types'

export function createSecretsManagerClient(
  config: SecretsManagerConnectionConfig
): SecretsManagerClient {
  return new SecretsManagerClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

export async function getSecretValue(
  client: SecretsManagerClient,
  secretId: string,
  versionId?: string | null,
  versionStage?: string | null
) {
  const command = new GetSecretValueCommand({
    SecretId: secretId,
    ...(versionId ? { VersionId: versionId } : {}),
    ...(versionStage ? { VersionStage: versionStage } : {}),
  })

  const response = await client.send(command)

  if (!response.SecretString && response.SecretBinary) {
    throw new Error(
      'Secret is stored as binary (SecretBinary). This integration only supports string secrets.'
    )
  }

  return {
    name: response.Name ?? '',
    secretValue: response.SecretString ?? '',
    arn: response.ARN ?? '',
    versionId: response.VersionId ?? '',
    versionStages: response.VersionStages ?? [],
    createdDate: response.CreatedDate?.toISOString() ?? null,
  }
}

export async function listSecrets(
  client: SecretsManagerClient,
  maxResults?: number | null,
  nextToken?: string | null
) {
  const command = new ListSecretsCommand({
    ...(maxResults ? { MaxResults: maxResults } : {}),
    ...(nextToken ? { NextToken: nextToken } : {}),
  })

  const response = await client.send(command)
  const secrets = (response.SecretList ?? []).map((secret: SecretListEntry) => ({
    name: secret.Name ?? '',
    arn: secret.ARN ?? '',
    description: secret.Description ?? null,
    createdDate: secret.CreatedDate?.toISOString() ?? null,
    lastChangedDate: secret.LastChangedDate?.toISOString() ?? null,
    lastAccessedDate: secret.LastAccessedDate?.toISOString() ?? null,
    rotationEnabled: secret.RotationEnabled ?? false,
    tags: secret.Tags?.map((t: Tag) => ({ key: t.Key ?? '', value: t.Value ?? '' })) ?? [],
  }))

  return {
    secrets,
    nextToken: response.NextToken ?? null,
    count: secrets.length,
  }
}

export async function createSecret(
  client: SecretsManagerClient,
  name: string,
  secretValue: string,
  description?: string | null
) {
  const command = new CreateSecretCommand({
    Name: name,
    SecretString: secretValue,
    ...(description ? { Description: description } : {}),
  })

  const response = await client.send(command)
  return {
    name: response.Name ?? '',
    arn: response.ARN ?? '',
    versionId: response.VersionId ?? '',
  }
}

export async function updateSecretValue(
  client: SecretsManagerClient,
  secretId: string,
  secretValue: string,
  description?: string | null
) {
  const command = new UpdateSecretCommand({
    SecretId: secretId,
    SecretString: secretValue,
    ...(description ? { Description: description } : {}),
  })

  const response = await client.send(command)
  return {
    name: response.Name ?? '',
    arn: response.ARN ?? '',
    versionId: response.VersionId ?? '',
  }
}

export async function deleteSecret(
  client: SecretsManagerClient,
  secretId: string,
  recoveryWindowInDays?: number | null,
  forceDelete?: boolean | null
) {
  const command = new DeleteSecretCommand({
    SecretId: secretId,
    ...(forceDelete ? { ForceDeleteWithoutRecovery: true } : {}),
    ...(!forceDelete && recoveryWindowInDays ? { RecoveryWindowInDays: recoveryWindowInDays } : {}),
  })

  const response = await client.send(command)
  return {
    name: response.Name ?? '',
    arn: response.ARN ?? '',
    deletionDate: response.DeletionDate?.toISOString() ?? null,
  }
}
