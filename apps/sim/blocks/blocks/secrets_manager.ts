import { SecretsManagerIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import type { SecretsManagerBaseResponse } from '@/tools/secrets_manager/types'

export const SecretsManagerBlock: BlockConfig<SecretsManagerBaseResponse> = {
  type: 'secrets_manager',
  name: 'AWS Secrets Manager',
  description: 'Connect to AWS Secrets Manager',
  longDescription:
    'Integrate AWS Secrets Manager into the workflow. Can retrieve, create, update, list, delete, describe, tag, untag, restore, and rotate secrets.',
  docsLink: 'https://docs.sim.ai/integrations/secrets_manager',
  category: 'tools',
  integrationType: IntegrationType.Security,
  bgColor: 'linear-gradient(45deg, #BD0816 0%, #FF5252 100%)',
  icon: SecretsManagerIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Secret', id: 'get_secret' },
        { label: 'List Secrets', id: 'list_secrets' },
        { label: 'Create Secret', id: 'create_secret' },
        { label: 'Update Secret', id: 'update_secret' },
        { label: 'Delete Secret', id: 'delete_secret' },
        { label: 'Describe Secret', id: 'describe_secret' },
        { label: 'Tag Secret', id: 'tag_resource' },
        { label: 'Untag Secret', id: 'untag_resource' },
        { label: 'Restore Secret', id: 'restore_secret' },
        { label: 'Rotate Secret', id: 'rotate_secret' },
      ],
      value: () => 'get_secret',
    },
    {
      id: 'region',
      title: 'AWS Region',
      type: 'short-input',
      placeholder: 'us-east-1',
      required: true,
    },
    {
      id: 'accessKeyId',
      title: 'AWS Access Key ID',
      type: 'short-input',
      placeholder: 'AKIA...',
      password: true,
      required: true,
    },
    {
      id: 'secretAccessKey',
      title: 'AWS Secret Access Key',
      type: 'short-input',
      placeholder: 'Your secret access key',
      password: true,
      required: true,
    },
    {
      id: 'secretId',
      title: 'Secret Name or ARN',
      type: 'short-input',
      placeholder: 'my-app/database-password',
      condition: {
        field: 'operation',
        value: [
          'get_secret',
          'update_secret',
          'delete_secret',
          'describe_secret',
          'tag_resource',
          'untag_resource',
          'restore_secret',
          'rotate_secret',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_secret',
          'update_secret',
          'delete_secret',
          'describe_secret',
          'tag_resource',
          'untag_resource',
          'restore_secret',
          'rotate_secret',
        ],
      },
    },
    {
      id: 'name',
      title: 'Secret Name',
      type: 'short-input',
      placeholder: 'my-app/database-password',
      condition: { field: 'operation', value: 'create_secret' },
      required: { field: 'operation', value: 'create_secret' },
    },
    {
      id: 'secretValue',
      title: 'Secret Value',
      type: 'code',
      placeholder: '{"username":"admin","password":"secret123"}',
      condition: { field: 'operation', value: ['create_secret', 'update_secret'] },
      required: { field: 'operation', value: ['create_secret', 'update_secret'] },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'short-input',
      placeholder: 'Database credentials for production',
      condition: { field: 'operation', value: ['create_secret', 'update_secret'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'versionId',
      title: 'Version ID',
      type: 'short-input',
      placeholder: 'Version UUID (optional)',
      condition: { field: 'operation', value: 'get_secret' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'versionStage',
      title: 'Version Stage',
      type: 'short-input',
      placeholder: 'AWSCURRENT',
      condition: { field: 'operation', value: 'get_secret' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'list_secrets' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'nextToken',
      title: 'Next Token',
      type: 'short-input',
      placeholder: 'Pagination token',
      condition: { field: 'operation', value: 'list_secrets' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'recoveryWindowInDays',
      title: 'Recovery Window (Days)',
      type: 'short-input',
      placeholder: '30',
      condition: { field: 'operation', value: 'delete_secret' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'forceDelete',
      title: 'Force Delete',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'delete_secret' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'code',
      placeholder: '[{"key":"env","value":"prod"}]',
      condition: { field: 'operation', value: 'tag_resource' },
      required: { field: 'operation', value: 'tag_resource' },
    },
    {
      id: 'tagKeys',
      title: 'Tag Keys',
      type: 'code',
      placeholder: '["env","team"]',
      condition: { field: 'operation', value: 'untag_resource' },
      required: { field: 'operation', value: 'untag_resource' },
    },
    {
      id: 'rotationLambdaARN',
      title: 'Rotation Lambda ARN',
      type: 'short-input',
      placeholder:
        'arn:aws:lambda:us-east-1:123456789012:function:my-rotation-fn (omit for managed rotation)',
      condition: { field: 'operation', value: 'rotate_secret' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'automaticallyAfterDays',
      title: 'Automatically After Days',
      type: 'short-input',
      placeholder: '30',
      condition: { field: 'operation', value: 'rotate_secret' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'duration',
      title: 'Rotation Window Duration',
      type: 'short-input',
      placeholder: '3h',
      condition: { field: 'operation', value: 'rotate_secret' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'scheduleExpression',
      title: 'Schedule Expression',
      type: 'short-input',
      placeholder: 'cron(0 16 1,15 * ? *) or rate(10 days)',
      condition: { field: 'operation', value: 'rotate_secret' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'rotateImmediately',
      title: 'Rotate Immediately',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'rotate_secret' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'clientRequestToken',
      title: 'Client Request Token',
      type: 'short-input',
      placeholder: 'Idempotency token (32-64 chars, optional)',
      condition: { field: 'operation', value: 'rotate_secret' },
      required: false,
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'secrets_manager_get_secret',
      'secrets_manager_list_secrets',
      'secrets_manager_create_secret',
      'secrets_manager_update_secret',
      'secrets_manager_delete_secret',
      'secrets_manager_describe_secret',
      'secrets_manager_tag_resource',
      'secrets_manager_untag_resource',
      'secrets_manager_restore_secret',
      'secrets_manager_rotate_secret',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'get_secret':
            return 'secrets_manager_get_secret'
          case 'list_secrets':
            return 'secrets_manager_list_secrets'
          case 'create_secret':
            return 'secrets_manager_create_secret'
          case 'update_secret':
            return 'secrets_manager_update_secret'
          case 'delete_secret':
            return 'secrets_manager_delete_secret'
          case 'describe_secret':
            return 'secrets_manager_describe_secret'
          case 'tag_resource':
            return 'secrets_manager_tag_resource'
          case 'untag_resource':
            return 'secrets_manager_untag_resource'
          case 'restore_secret':
            return 'secrets_manager_restore_secret'
          case 'rotate_secret':
            return 'secrets_manager_rotate_secret'
          default:
            throw new Error(`Invalid Secrets Manager operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          operation,
          forceDelete,
          recoveryWindowInDays,
          maxResults,
          automaticallyAfterDays,
          rotateImmediately,
          ...rest
        } = params

        const connectionConfig = {
          region: rest.region,
          accessKeyId: rest.accessKeyId,
          secretAccessKey: rest.secretAccessKey,
        }

        const result: Record<string, unknown> = { ...connectionConfig }

        switch (operation) {
          case 'get_secret':
            result.secretId = rest.secretId
            if (rest.versionId) result.versionId = rest.versionId
            if (rest.versionStage) result.versionStage = rest.versionStage
            break
          case 'list_secrets':
            if (maxResults) {
              const parsed = Number.parseInt(String(maxResults), 10)
              if (!Number.isNaN(parsed)) result.maxResults = parsed
            }
            if (rest.nextToken) result.nextToken = rest.nextToken
            break
          case 'create_secret':
            result.name = rest.name
            result.secretValue = rest.secretValue
            if (rest.description) result.description = rest.description
            break
          case 'update_secret':
            result.secretId = rest.secretId
            result.secretValue = rest.secretValue
            if (rest.description) result.description = rest.description
            break
          case 'delete_secret':
            result.secretId = rest.secretId
            if (recoveryWindowInDays) {
              const parsed = Number.parseInt(String(recoveryWindowInDays), 10)
              if (!Number.isNaN(parsed)) result.recoveryWindowInDays = parsed
            }
            if (forceDelete === 'true' || forceDelete === true) result.forceDelete = true
            break
          case 'describe_secret':
            result.secretId = rest.secretId
            break
          case 'tag_resource':
            result.secretId = rest.secretId
            result.tags = typeof rest.tags === 'string' ? JSON.parse(rest.tags) : rest.tags
            break
          case 'untag_resource':
            result.secretId = rest.secretId
            result.tagKeys =
              typeof rest.tagKeys === 'string' ? JSON.parse(rest.tagKeys) : rest.tagKeys
            break
          case 'restore_secret':
            result.secretId = rest.secretId
            break
          case 'rotate_secret':
            result.secretId = rest.secretId
            if (rest.clientRequestToken) result.clientRequestToken = rest.clientRequestToken
            if (rest.rotationLambdaARN) result.rotationLambdaARN = rest.rotationLambdaARN
            if (automaticallyAfterDays) {
              const parsed = Number.parseInt(String(automaticallyAfterDays), 10)
              if (!Number.isNaN(parsed)) result.automaticallyAfterDays = parsed
            }
            if (rest.duration) result.duration = rest.duration
            if (rest.scheduleExpression) result.scheduleExpression = rest.scheduleExpression
            if (rotateImmediately === 'false' || rotateImmediately === false) {
              result.rotateImmediately = false
            } else if (rotateImmediately === 'true' || rotateImmediately === true) {
              result.rotateImmediately = true
            }
            break
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Secrets Manager operation to perform' },
    region: { type: 'string', description: 'AWS region' },
    accessKeyId: { type: 'string', description: 'AWS access key ID' },
    secretAccessKey: { type: 'string', description: 'AWS secret access key' },
    secretId: { type: 'string', description: 'Secret name or ARN' },
    name: { type: 'string', description: 'Name for a new secret' },
    secretValue: { type: 'string', description: 'Secret value (plain text or JSON)' },
    description: { type: 'string', description: 'Secret description' },
    versionId: { type: 'string', description: 'Version ID' },
    versionStage: { type: 'string', description: 'Version stage (e.g., AWSCURRENT)' },
    maxResults: { type: 'number', description: 'Maximum number of results to return' },
    nextToken: { type: 'string', description: 'Pagination token' },
    recoveryWindowInDays: { type: 'number', description: 'Days before permanent deletion' },
    forceDelete: { type: 'string', description: 'Force immediate deletion' },
    tags: { type: 'json', description: 'Tags to attach, as an array of {key, value} pairs' },
    tagKeys: { type: 'json', description: 'Tag keys to remove, as an array of strings' },
    rotationLambdaARN: { type: 'string', description: 'ARN of the Lambda rotation function' },
    automaticallyAfterDays: { type: 'number', description: 'Days between automatic rotations' },
    duration: { type: 'string', description: 'Rotation window duration (e.g., 3h)' },
    scheduleExpression: { type: 'string', description: 'cron() or rate() rotation schedule' },
    rotateImmediately: { type: 'string', description: 'Whether to rotate immediately' },
    clientRequestToken: { type: 'string', description: 'Idempotency token for rotation' },
  },
  outputs: {
    message: {
      type: 'string',
      description: 'Operation status message',
    },
    name: {
      type: 'string',
      description: 'Name of the secret',
    },
    secretValue: {
      type: 'string',
      description: 'The decrypted secret value',
    },
    arn: {
      type: 'string',
      description: 'ARN of the secret',
    },
    versionId: {
      type: 'string',
      description: 'Version ID of the secret',
    },
    versionStages: {
      type: 'array',
      description: 'Staging labels attached to this version',
    },
    secrets: {
      type: 'json',
      description: 'List of secrets',
    },
    count: {
      type: 'number',
      description: 'Number of secrets returned',
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page',
    },
    createdDate: {
      type: 'string',
      description: 'Date the secret was created',
    },
    deletionDate: {
      type: 'string',
      description: 'Scheduled deletion date',
    },
    description: {
      type: 'string',
      description: 'Description of the secret',
    },
    kmsKeyId: {
      type: 'string',
      description: 'KMS key ID used to encrypt the secret',
    },
    rotationEnabled: {
      type: 'boolean',
      description: 'Whether automatic rotation is enabled',
    },
    rotationLambdaARN: {
      type: 'string',
      description: 'ARN of the Lambda function used for rotation',
    },
    rotationRules: {
      type: 'json',
      description:
        'Rotation schedule configuration (automaticallyAfterDays, duration, scheduleExpression)',
    },
    lastRotatedDate: {
      type: 'string',
      description: 'Date the secret was last rotated',
    },
    nextRotationDate: {
      type: 'string',
      description: 'Date the secret is next scheduled to rotate',
    },
    deletedDate: {
      type: 'string',
      description: 'Date the secret is scheduled for deletion, if any',
    },
    tags: {
      type: 'json',
      description: 'Tags attached to the secret',
    },
    owningService: {
      type: 'string',
      description: 'ID of the AWS service that manages this secret, if any',
    },
    primaryRegion: {
      type: 'string',
      description: 'The primary region of the secret, if replicated',
    },
    replicationStatus: {
      type: 'json',
      description: 'Replication status for each region the secret is replicated to',
    },
  },
}

export const SecretsManagerBlockMeta = {
  tags: ['cloud', 'secrets-management'],
  url: 'https://aws.amazon.com/secrets-manager',
  templates: [
    {
      icon: SecretsManagerIcon,
      title: 'Secrets Manager scheduled rotation',
      prompt:
        'Build a scheduled workflow that lists AWS Secrets Manager secrets, generates a new value for each secret past its rotation window, updates it with the new value, and writes the rotation status to a compliance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'enterprise'],
    },
    {
      icon: SecretsManagerIcon,
      title: 'Secrets Manager inventory auditor',
      prompt:
        'Create a scheduled workflow that lists all AWS Secrets Manager secrets, flags ones missing descriptions or older than a chosen age, writes a security review, and posts the findings to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SecretsManagerIcon,
      title: 'Secrets Manager stale-secret cleaner',
      prompt:
        'Build a scheduled workflow that lists AWS Secrets Manager secrets, identifies ones created before a chosen cutoff, requests owner approval in Slack, deletes the approved secrets, and writes the cleanup audit.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SecretsManagerIcon,
      title: 'Secrets Manager + Infisical mirror',
      prompt:
        'Create a workflow that mirrors secrets between AWS Secrets Manager and Infisical for cross-cloud applications, normalizes naming, and writes a sync log.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'sync'],
      alsoIntegrations: ['infisical'],
    },
    {
      icon: SecretsManagerIcon,
      title: 'Secrets Manager break-glass retrieval',
      prompt:
        'Build a workflow that gates retrieval of a sensitive AWS Secrets Manager secret behind a Slack approval, captures the requester and justification, fetches the secret only after sign-off, and writes the audit record.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SecretsManagerIcon,
      title: 'Secrets Manager + 1Password bridge',
      prompt:
        'Create a workflow that bridges select AWS Secrets Manager secrets into 1Password for human-shared credentials while keeping access logs aligned for audit.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'sync'],
      alsoIntegrations: ['onepassword'],
    },
    {
      icon: SecretsManagerIcon,
      title: 'Secrets Manager change watcher',
      prompt:
        'Build a scheduled workflow that polls AWS Secrets Manager secret version IDs, compares them against a baseline stored in a table, and pings the security Slack channel when a secret changes unexpectedly.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SecretsManagerIcon,
      title: 'Secrets Manager native rotation kickoff',
      prompt:
        'Build a scheduled workflow that describes AWS Secrets Manager secrets nearing their next rotation date, starts native rotation for the ones that are due, and writes the outcome to a compliance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'enterprise'],
    },
  ],
  skills: [
    {
      name: 'rotate-secret-value',
      description:
        'Update a stored secret in AWS Secrets Manager with a new value as part of a rotation flow. Use to push refreshed credentials without manual console edits.',
      content:
        '# Rotate Secret Value\n\nUpdate a secret with a new value.\n\n## Steps\n1. Confirm the target secret exists by getting it (do not log the returned value).\n2. Obtain the new secret value to store, as a string or JSON key/value payload.\n3. Update the secret with the new value, creating a new version.\n4. Verify by getting the secret and checking the updated version metadata, not the raw value.\n\n## Output\nConfirm the secret name and that a new version was created. Never print the secret value itself.',
    },
    {
      name: 'audit-secret-inventory',
      description:
        'List secrets in AWS Secrets Manager and report metadata like last-changed and rotation status. Use for hygiene checks and finding stale secrets.',
      content:
        '# Audit Secret Inventory\n\nReport on the secrets that exist without exposing their values.\n\n## Steps\n1. List secrets to enumerate names, descriptions, and tags.\n2. For each secret of interest, read metadata such as last changed and last rotated dates.\n3. Flag secrets that are stale, undescribed, or appear unused.\n4. Summarize without ever fetching or printing secret values.\n\n## Output\nAn inventory summary: secret names with last-changed and rotation status, and stale or unrotated secrets called out. No secret values.',
    },
    {
      name: 'store-new-secret',
      description:
        'Create a new secret in AWS Secrets Manager from a provided credential or generated value. Use to register app credentials, API keys, or DB passwords centrally.',
      content:
        '# Store New Secret\n\nRegister a new credential in Secrets Manager.\n\n## Steps\n1. Choose a clear hierarchical name for the secret, such as my-app/prod/db-password.\n2. Assemble the value to store — a plain string, or a JSON object of key/value pairs for structured credentials.\n3. Create the secret with that name, value, and a description of what it is and where it is used.\n4. Confirm creation by reading back the version metadata, not the value.\n\n## Output\nConfirm the secret name, ARN, and new version ID. Never echo the stored secret value back.',
    },
    {
      name: 'decommission-secret',
      description:
        'Schedule deletion of a secret in AWS Secrets Manager with a recovery window so it can be restored if needed. Use to retire unused or rotated-out credentials safely.',
      content:
        '# Decommission Secret\n\nRetire a secret without permanently losing it immediately.\n\n## Steps\n1. Confirm the target secret and that nothing still depends on it.\n2. Schedule deletion with a recovery window (e.g. 30 days) so it can be restored during that period; reserve force delete for confirmed-orphaned secrets only.\n3. Record the scheduled deletion date.\n4. Re-list secrets to confirm it is marked for deletion.\n\n## Output\nConfirm the secret name and the scheduled deletion date, or that immediate deletion was requested. Do not print the secret value.',
    },
    {
      name: 'start-native-rotation',
      description:
        'Start or reconfigure AWS Secrets Manager native rotation for a secret that already has a rotation Lambda configured. Use when compliance requires automatic, scheduled rotation rather than manual updates.',
      content:
        '# Start Native Rotation\n\nConfigure or trigger built-in Secrets Manager rotation.\n\n## Steps\n1. Describe the target secret to confirm it has a rotation Lambda ARN configured (or supply one).\n2. Decide the rotation schedule: a fixed interval in days, or a cron/rate schedule expression, plus an optional rotation window duration.\n3. Start rotation with the chosen schedule; rotation runs immediately unless configured to wait for the next window.\n4. Re-describe the secret afterward to confirm the next rotation date and rotation-enabled status.\n\n## Output\nConfirm the secret name, whether rotation is now enabled, and the next scheduled rotation date. Never print the secret value.',
    },
    {
      name: 'restore-deleted-secret',
      description:
        'Cancel a scheduled deletion in AWS Secrets Manager to restore access to a secret before its recovery window elapses. Use to reverse an accidental or premature delete.',
      content:
        '# Restore Deleted Secret\n\nUndo a pending deletion while the recovery window is still open.\n\n## Steps\n1. Describe the secret to confirm it has a scheduled deletion date.\n2. Restore the secret, which clears the scheduled deletion.\n3. Re-describe the secret to confirm the deletion date is cleared.\n\n## Output\nConfirm the secret name and ARN, and that it is no longer scheduled for deletion.',
    },
    {
      name: 'tag-secret-for-governance',
      description:
        'Attach or remove ownership, environment, or cost-center tags on an AWS Secrets Manager secret for governance and cost allocation. Use to keep secret metadata consistent with tagging policy.',
      content:
        '# Tag Secret for Governance\n\nKeep secret tags aligned with organizational tagging policy.\n\n## Steps\n1. Describe the secret to see its current tags.\n2. Attach the required tags (e.g. owner, environment, cost-center) as key/value pairs, or remove tags that no longer apply by key.\n3. Re-describe the secret to confirm the tag set matches policy.\n\n## Output\nConfirm the secret name and the resulting tag keys. Do not print the secret value.',
    },
  ],
} as const satisfies BlockMeta
