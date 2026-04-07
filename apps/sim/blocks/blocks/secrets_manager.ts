import { SecretsManagerIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import type { SecretsManagerBaseResponse } from '@/tools/secrets_manager/types'

export const SecretsManagerBlock: BlockConfig<SecretsManagerBaseResponse> = {
  type: 'secrets_manager',
  name: 'AWS Secrets Manager',
  description: 'Connect to AWS Secrets Manager',
  longDescription:
    'Integrate AWS Secrets Manager into the workflow. Can retrieve, create, update, list, and delete secrets.',
  docsLink: 'https://docs.sim.ai/tools/secrets-manager',
  category: 'tools',
  integrationType: IntegrationType.DeveloperTools,
  tags: ['cloud', 'secrets-management'],
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
