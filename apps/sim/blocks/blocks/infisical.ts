import { InfisicalIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { InfisicalResponse } from '@/tools/infisical/types'

export const InfisicalBlock: BlockConfig<InfisicalResponse> = {
  type: 'infisical',
  name: 'Infisical',
  description: 'Manage secrets with Infisical',
  longDescription:
    'Integrate Infisical into your workflow. List, get, create, update, and delete secrets across project environments.',
  docsLink: 'https://docs.sim.ai/tools/infisical',
  category: 'tools',
  integrationType: IntegrationType.Security,
  tags: ['secrets-management'],
  bgColor: '#F7FE62',
  icon: InfisicalIcon,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Secrets', id: 'list_secrets' },
        { label: 'Get Secret', id: 'get_secret' },
        { label: 'Create Secret', id: 'create_secret' },
        { label: 'Update Secret', id: 'update_secret' },
        { label: 'Delete Secret', id: 'delete_secret' },
      ],
      value: () => 'list_secrets',
    },
    {
      id: 'projectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Enter project ID',
      required: true,
    },
    {
      id: 'environment',
      title: 'Environment',
      type: 'short-input',
      placeholder: 'e.g., dev, staging, prod',
      required: true,
    },
    {
      id: 'secretName',
      title: 'Secret Name',
      type: 'short-input',
      placeholder: 'Enter secret name',
      condition: {
        field: 'operation',
        value: ['get_secret', 'create_secret', 'update_secret', 'delete_secret'],
      },
      required: {
        field: 'operation',
        value: ['get_secret', 'create_secret', 'update_secret', 'delete_secret'],
      },
    },
    {
      id: 'secretValue',
      title: 'Secret Value',
      type: 'short-input',
      placeholder: 'Enter secret value',
      password: true,
      condition: { field: 'operation', value: 'create_secret' },
      required: { field: 'operation', value: 'create_secret' },
    },
    {
      id: 'updateSecretValue',
      title: 'Secret Value',
      type: 'short-input',
      placeholder: 'Enter new secret value',
      password: true,
      condition: { field: 'operation', value: 'update_secret' },
    },
    {
      id: 'secretComment',
      title: 'Comment',
      type: 'short-input',
      placeholder: 'Optional comment',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_secret', 'update_secret'] },
    },
    {
      id: 'newSecretName',
      title: 'New Secret Name',
      type: 'short-input',
      placeholder: 'Rename secret to...',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_secret' },
    },
    {
      id: 'baseUrl',
      title: 'Instance URL',
      type: 'short-input',
      placeholder: 'https://us.infisical.com (default)',
      mode: 'advanced',
    },
    {
      id: 'secretPath',
      title: 'Secret Path',
      type: 'short-input',
      placeholder: '/ (default)',
      mode: 'advanced',
    },
    {
      id: 'recursive',
      title: 'Recursive',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_secrets' },
    },
    {
      id: 'includeImports',
      title: 'Include Imports',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_secrets' },
    },
    {
      id: 'tagSlugs',
      title: 'Filter by Tags',
      type: 'short-input',
      placeholder: 'Comma-separated tag slugs',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_secrets' },
    },
    {
      id: 'tagIds',
      title: 'Tag IDs',
      type: 'short-input',
      placeholder: 'Comma-separated tag IDs',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_secret', 'update_secret'] },
    },
    {
      id: 'secretVersion',
      title: 'Version',
      type: 'short-input',
      placeholder: 'Specific version number',
      mode: 'advanced',
      condition: { field: 'operation', value: 'get_secret' },
    },
    {
      id: 'apiKey',
      title: 'API Token',
      type: 'short-input',
      placeholder: 'Enter your Infisical API token',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: [
      'infisical_list_secrets',
      'infisical_get_secret',
      'infisical_create_secret',
      'infisical_update_secret',
      'infisical_delete_secret',
    ],
    config: {
      tool: (params) => `infisical_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {
          apiKey: params.apiKey,
          projectId: params.projectId,
          environment: params.environment,
        }

        if (params.baseUrl) result.baseUrl = params.baseUrl
        if (params.secretPath) result.secretPath = params.secretPath

        switch (params.operation) {
          case 'list_secrets':
            if (params.recursive != null) result.recursive = params.recursive
            if (params.includeImports != null) result.includeImports = params.includeImports
            if (params.tagSlugs) result.tagSlugs = params.tagSlugs
            break
          case 'get_secret':
            result.secretName = params.secretName
            if (params.secretVersion) {
              const v = Number(params.secretVersion)
              if (!Number.isNaN(v)) result.version = v
            }
            break
          case 'create_secret':
            result.secretName = params.secretName
            result.secretValue = params.secretValue
            if (params.secretComment) result.secretComment = params.secretComment
            if (params.tagIds) result.tagIds = params.tagIds
            break
          case 'update_secret':
            result.secretName = params.secretName
            if (params.updateSecretValue) result.secretValue = params.updateSecretValue
            if (params.secretComment) result.secretComment = params.secretComment
            if (params.newSecretName) result.newSecretName = params.newSecretName
            if (params.tagIds) result.tagIds = params.tagIds
            break
          case 'delete_secret':
            result.secretName = params.secretName
            break
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Infisical API token' },
    baseUrl: { type: 'string', description: 'Infisical instance URL' },
    projectId: { type: 'string', description: 'Project ID' },
    environment: { type: 'string', description: 'Environment slug' },
    secretName: { type: 'string', description: 'Secret name' },
    secretValue: { type: 'string', description: 'Secret value' },
    updateSecretValue: { type: 'string', description: 'New secret value for update' },
    secretComment: { type: 'string', description: 'Secret comment' },
    newSecretName: { type: 'string', description: 'New name for secret rename' },
    secretPath: { type: 'string', description: 'Secret path' },
    recursive: { type: 'boolean', description: 'Fetch secrets recursively' },
    includeImports: { type: 'boolean', description: 'Include imported secrets' },
    tagSlugs: { type: 'string', description: 'Comma-separated tag slugs to filter by' },
    tagIds: { type: 'string', description: 'Comma-separated tag IDs to attach' },
    secretVersion: { type: 'string', description: 'Specific secret version to retrieve' },
  },
  outputs: {
    secrets: { type: 'json', description: 'Array of secrets (list operation)' },
    count: { type: 'number', description: 'Number of secrets returned' },
    secret: { type: 'json', description: 'Secret object (get/create/update/delete operations)' },
  },
}
