import type { InfisicalGetSecretParams, InfisicalGetSecretResponse } from '@/tools/infisical/types'
import type { ToolConfig } from '@/tools/types'

export const getSecretTool: ToolConfig<InfisicalGetSecretParams, InfisicalGetSecretResponse> = {
  id: 'infisical_get_secret',
  name: 'Infisical Get Secret',
  description: 'Retrieve a single secret by name from a project environment.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Infisical API token',
    },
    baseUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Infisical instance URL (default: "https://us.infisical.com"). Use "https://eu.infisical.com" for EU Cloud or your self-hosted URL.',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the project',
    },
    environment: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The environment slug (e.g., "dev", "staging", "prod")',
    },
    secretName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the secret to retrieve',
    },
    secretPath: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The path of the secret (default: "/")',
    },
    version: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Specific version of the secret to retrieve',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Secret type: "shared" or "personal" (default: "shared")',
    },
    viewSecretValue: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include the secret value in the response (default: true)',
    },
    expandSecretReferences: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to expand secret references (default: true)',
    },
  },

  request: {
    method: 'GET',
    url: (params) => {
      const searchParams = new URLSearchParams()
      searchParams.set('projectId', params.projectId)
      searchParams.set('environment', params.environment)
      if (params.secretPath) searchParams.set('secretPath', params.secretPath)
      if (params.version != null) searchParams.set('version', String(params.version))
      if (params.type) searchParams.set('type', params.type)
      if (params.viewSecretValue != null)
        searchParams.set('viewSecretValue', String(params.viewSecretValue))
      if (params.expandSecretReferences != null)
        searchParams.set('expandSecretReferences', String(params.expandSecretReferences))
      const base = params.baseUrl?.replace(/\/+$/, '') ?? 'https://us.infisical.com'
      return `${base}/api/v4/secrets/${encodeURIComponent(params.secretName.trim())}?${searchParams.toString()}`
    },
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return {
        success: false,
        output: { secret: {} as InfisicalGetSecretResponse['output']['secret'] },
        error: data.message ?? `Request failed with status ${response.status}`,
      }
    }
    const s = data.secret ?? data
    return {
      success: true,
      output: {
        secret: {
          id: s.id ?? null,
          workspace: s.workspace ?? null,
          secretKey: s.secretKey ?? null,
          secretValue: s.secretValue ?? null,
          secretComment: s.secretComment ?? null,
          secretPath: s.secretPath ?? null,
          version: s.version ?? null,
          type: s.type ?? null,
          environment: s.environment ?? null,
          tags:
            (s.tags as Array<Record<string, unknown>> | undefined)?.map(
              (t: Record<string, unknown>) => ({
                id: (t.id as string) ?? null,
                slug: (t.slug as string) ?? null,
                color: (t.color as string) ?? null,
                name: (t.name as string) ?? null,
              })
            ) ?? [],
          secretMetadata:
            (s.secretMetadata as Array<Record<string, unknown>> | undefined)?.map(
              (m: Record<string, unknown>) => ({
                key: (m.key as string) ?? null,
                value: (m.value as string) ?? null,
              })
            ) ?? [],
          createdAt: s.createdAt ?? null,
          updatedAt: s.updatedAt ?? null,
        },
      },
    }
  },

  outputs: {
    secret: {
      type: 'object',
      description: 'The retrieved secret',
      properties: {
        id: { type: 'string', description: 'Secret ID' },
        workspace: { type: 'string', description: 'Workspace/project ID', optional: true },
        secretKey: { type: 'string', description: 'Secret name/key' },
        secretValue: { type: 'string', description: 'Secret value', optional: true },
        secretComment: { type: 'string', description: 'Secret comment', optional: true },
        secretPath: { type: 'string', description: 'Secret path', optional: true },
        version: { type: 'number', description: 'Secret version' },
        type: { type: 'string', description: 'Secret type (shared or personal)' },
        environment: { type: 'string', description: 'Environment slug' },
        tags: {
          type: 'array',
          description: 'Tags attached to the secret',
          optional: true,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Tag ID' },
              slug: { type: 'string', description: 'Tag slug' },
              color: { type: 'string', description: 'Tag color', optional: true },
              name: { type: 'string', description: 'Tag name' },
            },
          },
        },
        secretMetadata: {
          type: 'array',
          description: 'Custom metadata key-value pairs',
          optional: true,
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Metadata key' },
              value: { type: 'string', description: 'Metadata value' },
            },
          },
        },
        createdAt: { type: 'string', description: 'Creation timestamp' },
        updatedAt: { type: 'string', description: 'Last update timestamp' },
      },
    },
  },
}
