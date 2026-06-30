import { InfisicalIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { InfisicalResponse } from '@/tools/infisical/types'

export const InfisicalBlock: BlockConfig<InfisicalResponse> = {
  type: 'infisical',
  name: 'Infisical',
  description: 'Manage secrets with Infisical',
  longDescription:
    'Integrate Infisical into your workflow. List, get, create, update, and delete secrets across project environments.',
  docsLink: 'https://docs.sim.ai/integrations/infisical',
  category: 'tools',
  integrationType: IntegrationType.Security,
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
    secrets: {
      type: 'json',
      description:
        'Array of secrets from the list operation, each with [{id, secretKey, secretValue, secretComment, secretPath, version, type, environment, isRotatedSecret, rotationId, tags, secretMetadata, actor, createdAt, updatedAt}]',
    },
    count: { type: 'number', description: 'Number of secrets returned' },
    secret: {
      type: 'json',
      description:
        'Secret object from get/create/update/delete operations (id, secretKey, secretValue, secretComment, secretPath, version, type, environment, isRotatedSecret, rotationId, tags, secretMetadata, actor, createdAt, updatedAt)',
    },
  },
}

export const InfisicalBlockMeta = {
  tags: ['secrets-management'],
  url: 'https://infisical.com',
  templates: [
    {
      icon: InfisicalIcon,
      title: 'Infisical secret rotation orchestrator',
      prompt:
        'Build a scheduled workflow that lists Infisical secrets, generates fresh values for those due for rotation, updates them across each environment, and writes rotation status to a compliance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise'],
    },
    {
      icon: InfisicalIcon,
      title: 'Infisical environment drift detector',
      prompt:
        'Create a scheduled workflow that diffs Infisical environments against expected schemas, alerts on missing or extra secrets, and writes a remediation queue.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: InfisicalIcon,
      title: 'Infisical env bootstrapper',
      prompt:
        'Build a workflow that on a Workday new-hire event creates the standard set of Infisical secrets for the new engineer’s scoped dev environment from a template, and writes the provisioning record to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise'],
      alsoIntegrations: ['workday'],
    },
    {
      icon: InfisicalIcon,
      title: 'Infisical offboarding rotation',
      prompt:
        'Create a workflow that on a Workday termination rotates the shared Infisical secrets the departing engineer had access to by generating new values and updating them across environments, then writes the action log to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise'],
      alsoIntegrations: ['workday'],
    },
    {
      icon: InfisicalIcon,
      title: 'Infisical CI sync',
      prompt:
        'Build a workflow that mirrors Infisical secrets into GitHub Actions environments for CI deploys, keeping the secret store as the single source of truth.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'sync'],
      alsoIntegrations: ['github'],
    },
    {
      icon: InfisicalIcon,
      title: 'Infisical secret-inventory reviewer',
      prompt:
        'Create a scheduled quarterly workflow that lists Infisical secrets per project and environment, flags ones with weak or aged values for owner attestation in Slack, and writes the review to a compliance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: InfisicalIcon,
      title: 'Infisical secret-inventory snapshot',
      prompt:
        'Build a scheduled workflow that lists Infisical secrets across environments, writes a redacted inventory snapshot to S3 for long-term retention, and tracks secret count trends in a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['s3'],
    },
  ],
  skills: [
    {
      name: 'fetch-secret-for-run',
      description:
        'Retrieve a named secret from Infisical to use as a credential during a workflow run.',
      content:
        '# Fetch a Secret for a Run\n\nPull a single secret from Infisical so a downstream step can authenticate without hardcoding credentials.\n\n## Steps\n1. Identify the project, environment (e.g. dev, staging, prod), and secret path.\n2. Get the secret by name from that scope.\n3. Pass the value to the consuming step. Never echo the raw secret into logs or output.\n\n## Output\nConfirm the secret was retrieved (by name and environment) and that it was used. Do not print the secret value itself.',
    },
    {
      name: 'rotate-secret',
      description: 'Update an existing secret in Infisical with a new value as part of a rotation.',
      content:
        '# Rotate a Secret\n\nReplace a secret value in Infisical during a credential rotation.\n\n## Steps\n1. Confirm the project, environment, and secret name to rotate.\n2. Update the secret with the new value at that path.\n3. Optionally read the secret back by name to confirm it now exists (without printing the value).\n\n## Output\nConfirm the secret name and environment that was rotated and the timestamp. Never expose the old or new value.',
    },
    {
      name: 'audit-environment-secrets',
      description:
        'List the secret names present in an Infisical environment for an inventory or audit.',
      content:
        '# Audit Environment Secrets\n\nProduce an inventory of which secrets exist in an Infisical environment without exposing their values.\n\n## Steps\n1. Choose the project, environment, and path to audit.\n2. List secrets at that scope and collect only the keys and metadata.\n3. Compare against the expected set if one is provided and flag missing or unexpected keys.\n\n## Output\nReturn a list of secret names (keys only) with count, and any discrepancies versus the expected set. Never include secret values.',
    },
  ],
} as const satisfies BlockMeta
