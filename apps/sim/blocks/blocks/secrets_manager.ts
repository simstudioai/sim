import { SecretsManagerIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import type { SecretsManagerBaseResponse } from '@/tools/secrets_manager/types'

export const SecretsManagerBlock: BlockConfig<SecretsManagerBaseResponse> = {
  type: 'secrets_manager',
  name: 'AWS Secrets Manager',
  description: 'Connect to AWS Secrets Manager',
  longDescription:
    'Integrate AWS Secrets Manager into the workflow. Can retrieve, create, update, list, and delete secrets.',
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
      condition: { field: 'operation', value: ['get_secret', 'update_secret', 'delete_secret'] },
      required: { field: 'operation', value: ['get_secret', 'update_secret', 'delete_secret'] },
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
  ],
  tools: {
    access: [
      'secrets_manager_get_secret',
      'secrets_manager_list_secrets',
      'secrets_manager_create_secret',
      'secrets_manager_update_secret',
      'secrets_manager_delete_secret',
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
          default:
            throw new Error(`Invalid Secrets Manager operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation, forceDelete, recoveryWindowInDays, maxResults, ...rest } = params

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
  ],
} as const satisfies BlockMeta
