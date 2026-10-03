import type { RotationRulesType, SecretListEntry, Tag } from '@aws-sdk/client-secrets-manager'
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  GetSecretValueCommand,
  ListSecretsCommand,
  RestoreSecretCommand,
  RotateSecretCommand,
  SecretsManagerClient,
  TagResourceCommand,
  UntagResourceCommand,
  UpdateSecretCommand,
} from '@aws-sdk/client-secrets-manager'

interface SecretsManagerConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

function mapRotationRules(rules: RotationRulesType | undefined) {
  if (!rules) return null
  return {
    automaticallyAfterDays: rules.AutomaticallyAfterDays ?? null,
    duration: rules.Duration ?? null,
    scheduleExpression: rules.ScheduleExpression ?? null,
  }
}

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
  versionStage?: string | null,
  signal?: AbortSignal
) {
  const command = new GetSecretValueCommand({
    SecretId: secretId,
    ...(versionId ? { VersionId: versionId } : {}),
    ...(versionStage ? { VersionStage: versionStage } : {}),
  })

  const response = await client.send(command, { abortSignal: signal })

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
  nextToken?: string | null,
  signal?: AbortSignal
) {
  const command = new ListSecretsCommand({
    ...(maxResults ? { MaxResults: maxResults } : {}),
    ...(nextToken ? { NextToken: nextToken } : {}),
  })

  const response = await client.send(command, { abortSignal: signal })
  const secrets = (response.SecretList ?? []).map((secret: SecretListEntry) => ({
    name: secret.Name ?? '',
    arn: secret.ARN ?? '',
    description: secret.Description ?? null,
    createdDate: secret.CreatedDate?.toISOString() ?? null,
    lastChangedDate: secret.LastChangedDate?.toISOString() ?? null,
    lastAccessedDate: secret.LastAccessedDate?.toISOString() ?? null,
    rotationEnabled: secret.RotationEnabled ?? false,
    tags: secret.Tags?.map((tag: Tag) => ({ key: tag.Key ?? '', value: tag.Value ?? '' })) ?? [],
    rotationRules: mapRotationRules(secret.RotationRules),
    lastRotatedDate: secret.LastRotatedDate?.toISOString() ?? null,
    nextRotationDate: secret.NextRotationDate?.toISOString() ?? null,
    deletedDate: secret.DeletedDate?.toISOString() ?? null,
    secretVersionsToStages: secret.SecretVersionsToStages ?? null,
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
  description?: string | null,
  signal?: AbortSignal
) {
  const command = new CreateSecretCommand({
    Name: name,
    SecretString: secretValue,
    ...(description ? { Description: description } : {}),
  })

  const response = await client.send(command, { abortSignal: signal })
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
  description?: string | null,
  signal?: AbortSignal
) {
  const command = new UpdateSecretCommand({
    SecretId: secretId,
    SecretString: secretValue,
    ...(description ? { Description: description } : {}),
  })

  const response = await client.send(command, { abortSignal: signal })
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
  forceDelete?: boolean | null,
  signal?: AbortSignal
) {
  const command = new DeleteSecretCommand({
    SecretId: secretId,
    ...(forceDelete ? { ForceDeleteWithoutRecovery: true } : {}),
    ...(!forceDelete && recoveryWindowInDays ? { RecoveryWindowInDays: recoveryWindowInDays } : {}),
  })

  const response = await client.send(command, { abortSignal: signal })
  return {
    name: response.Name ?? '',
    arn: response.ARN ?? '',
    deletionDate: response.DeletionDate?.toISOString() ?? null,
  }
}

export async function describeSecret(
  client: SecretsManagerClient,
  secretId: string,
  signal?: AbortSignal
) {
  const command = new DescribeSecretCommand({ SecretId: secretId })
  const response = await client.send(command, { abortSignal: signal })

  return {
    name: response.Name ?? '',
    arn: response.ARN ?? '',
    description: response.Description ?? null,
    kmsKeyId: response.KmsKeyId ?? null,
    rotationEnabled: response.RotationEnabled ?? false,
    rotationLambdaARN: response.RotationLambdaARN ?? null,
    rotationRules: mapRotationRules(response.RotationRules),
    lastRotatedDate: response.LastRotatedDate?.toISOString() ?? null,
    lastChangedDate: response.LastChangedDate?.toISOString() ?? null,
    lastAccessedDate: response.LastAccessedDate?.toISOString() ?? null,
    deletedDate: response.DeletedDate?.toISOString() ?? null,
    nextRotationDate: response.NextRotationDate?.toISOString() ?? null,
    tags: response.Tags?.map((tag: Tag) => ({ key: tag.Key ?? '', value: tag.Value ?? '' })) ?? [],
    versionIdsToStages: response.VersionIdsToStages ?? null,
    owningService: response.OwningService ?? null,
    createdDate: response.CreatedDate?.toISOString() ?? null,
    primaryRegion: response.PrimaryRegion ?? null,
    replicationStatus:
      response.ReplicationStatus?.map((replication) => ({
        region: replication.Region ?? '',
        kmsKeyId: replication.KmsKeyId ?? null,
        status: replication.Status ?? null,
        statusMessage: replication.StatusMessage ?? null,
        lastAccessedDate: replication.LastAccessedDate?.toISOString() ?? null,
      })) ?? [],
  }
}

export async function tagResource(
  client: SecretsManagerClient,
  secretId: string,
  tags: Tag[],
  signal?: AbortSignal
) {
  const command = new TagResourceCommand({ SecretId: secretId, Tags: tags })
  await client.send(command, { abortSignal: signal })
  return { name: secretId }
}

export async function untagResource(
  client: SecretsManagerClient,
  secretId: string,
  tagKeys: string[],
  signal?: AbortSignal
) {
  const command = new UntagResourceCommand({ SecretId: secretId, TagKeys: tagKeys })
  await client.send(command, { abortSignal: signal })
  return { name: secretId }
}

export async function restoreSecret(
  client: SecretsManagerClient,
  secretId: string,
  signal?: AbortSignal
) {
  const command = new RestoreSecretCommand({ SecretId: secretId })
  const response = await client.send(command, { abortSignal: signal })
  return {
    name: response.Name ?? '',
    arn: response.ARN ?? '',
  }
}

interface RotationRulesInput {
  automaticallyAfterDays?: number | null
  duration?: string | null
  scheduleExpression?: string | null
}

export async function rotateSecret(
  client: SecretsManagerClient,
  secretId: string,
  clientRequestToken?: string | null,
  rotationLambdaARN?: string | null,
  rotationRules?: RotationRulesInput | null,
  rotateImmediately?: boolean | null,
  signal?: AbortSignal
) {
  const hasRotationRules = Boolean(
    rotationRules?.automaticallyAfterDays ||
      rotationRules?.duration ||
      rotationRules?.scheduleExpression
  )

  const command = new RotateSecretCommand({
    SecretId: secretId,
    ...(clientRequestToken ? { ClientRequestToken: clientRequestToken } : {}),
    ...(rotationLambdaARN ? { RotationLambdaARN: rotationLambdaARN } : {}),
    ...(hasRotationRules
      ? {
          RotationRules: {
            ...(rotationRules?.automaticallyAfterDays
              ? { AutomaticallyAfterDays: rotationRules.automaticallyAfterDays }
              : {}),
            ...(rotationRules?.duration ? { Duration: rotationRules.duration } : {}),
            ...(rotationRules?.scheduleExpression
              ? { ScheduleExpression: rotationRules.scheduleExpression }
              : {}),
          },
        }
      : {}),
    ...(rotateImmediately === undefined || rotateImmediately === null
      ? {}
      : { RotateImmediately: rotateImmediately }),
  })

  const response = await client.send(command, { abortSignal: signal })
  return {
    name: response.Name ?? '',
    arn: response.ARN ?? '',
    versionId: response.VersionId ?? '',
  }
}
