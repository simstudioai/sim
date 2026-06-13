import type {
  InfisicalListSecretsParams,
  InfisicalListSecretsResponse,
} from '@/tools/infisical/types'
import type { ToolConfig } from '@/tools/types'

export const listSecretsTool: ToolConfig<InfisicalListSecretsParams, InfisicalListSecretsResponse> =
  {
    id: 'infisical_list_secrets',
    name: 'Infisical List Secrets',
    description:
      'List all secrets in a project environment. Returns secret keys, values, comments, tags, and metadata.',
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
        description: 'The ID of the project to list secrets from',
      },
      environment: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The environment slug (e.g., "dev", "staging", "prod")',
      },
      secretPath: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'The path of the secrets (default: "/")',
      },
      recursive: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether to fetch secrets recursively from subdirectories',
      },
      expandSecretReferences: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether to expand secret references (default: true)',
      },
      viewSecretValue: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether to include secret values in the response (default: true)',
      },
      includeImports: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether to include imported secrets (default: true)',
      },
      tagSlugs: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated tag slugs to filter secrets by',
      },
    },

    request: {
      method: 'GET',
      url: (params) => {
        const searchParams = new URLSearchParams()
        searchParams.set('projectId', params.projectId)
        searchParams.set('environment', params.environment)
        if (params.secretPath) searchParams.set('secretPath', params.secretPath)
        if (params.recursive != null) searchParams.set('recursive', String(params.recursive))
        if (params.expandSecretReferences != null)
          searchParams.set('expandSecretReferences', String(params.expandSecretReferences))
        if (params.viewSecretValue != null)
          searchParams.set('viewSecretValue', String(params.viewSecretValue))
        if (params.includeImports != null)
          searchParams.set('includeImports', String(params.includeImports))
        if (params.tagSlugs) searchParams.set('tagSlugs', params.tagSlugs)
        const base = params.baseUrl?.replace(/\/+$/, '') ?? 'https://us.infisical.com'
        return `${base}/api/v4/secrets?${searchParams.toString()}`
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
          output: { secrets: [], count: 0 },
          error: data.message ?? `Request failed with status ${response.status}`,
        }
      }
      const secrets = (data.secrets ?? []).map((s: Record<string, unknown>) => {
        const actor = s.actor as Record<string, unknown> | undefined
        return {
          id: s.id ?? null,
          workspace: s.workspace ?? null,
          secretKey: s.secretKey ?? null,
          secretValue: s.secretValue ?? null,
          secretComment: s.secretComment ?? null,
          secretPath: s.secretPath ?? null,
          version: s.version ?? null,
          type: s.type ?? null,
          environment: s.environment ?? null,
          secretValueHidden: s.secretValueHidden ?? null,
          isRotatedSecret: s.isRotatedSecret ?? null,
          rotationId: s.rotationId ?? null,
          secretReminderNote: s.secretReminderNote ?? null,
          secretReminderRepeatDays: s.secretReminderRepeatDays ?? null,
          skipMultilineEncoding: s.skipMultilineEncoding ?? null,
          actor: actor
            ? {
                actorId: (actor.actorId as string) ?? null,
                actorType: (actor.actorType as string) ?? null,
                name: (actor.name as string) ?? null,
                membershipId: (actor.membershipId as string) ?? null,
                groupId: (actor.groupId as string) ?? null,
              }
            : null,
          tags:
            (s.tags as Array<Record<string, unknown>> | undefined)?.map((t) => ({
              id: (t.id as string) ?? null,
              slug: (t.slug as string) ?? null,
              color: (t.color as string) ?? null,
              name: (t.name as string) ?? null,
            })) ?? [],
          secretMetadata:
            (s.secretMetadata as Array<Record<string, unknown>> | undefined)?.map((m) => ({
              key: (m.key as string) ?? null,
              value: (m.value as string) ?? null,
              isEncrypted: (m.isEncrypted as boolean) ?? null,
            })) ?? [],
          createdAt: s.createdAt ?? null,
          updatedAt: s.updatedAt ?? null,
        }
      })
      return {
        success: true,
        output: {
          secrets,
          count: secrets.length,
        },
      }
    },

    outputs: {
      secrets: {
        type: 'array',
        description: 'Array of secrets',
        items: {
          type: 'object',
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
            secretValueHidden: {
              type: 'boolean',
              description: 'Whether the secret value was hidden in the response',
              optional: true,
            },
            isRotatedSecret: {
              type: 'boolean',
              description: 'Whether the secret is managed by secret rotation',
              optional: true,
            },
            rotationId: { type: 'string', description: 'Secret rotation ID', optional: true },
            secretReminderNote: {
              type: 'string',
              description: 'Rotation reminder note',
              optional: true,
            },
            secretReminderRepeatDays: {
              type: 'number',
              description: 'Rotation reminder interval in days',
              optional: true,
            },
            skipMultilineEncoding: {
              type: 'boolean',
              description: 'Whether multiline encoding is skipped for this secret',
              optional: true,
            },
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
                  isEncrypted: {
                    type: 'boolean',
                    description: 'Whether the metadata value is encrypted',
                    optional: true,
                  },
                },
              },
            },
            actor: {
              type: 'object',
              description: 'Identity that last modified the secret',
              optional: true,
              properties: {
                actorId: { type: 'string', description: 'Actor ID', optional: true },
                actorType: { type: 'string', description: 'Actor type', optional: true },
                name: { type: 'string', description: 'Actor name', optional: true },
                membershipId: { type: 'string', description: 'Membership ID', optional: true },
                groupId: { type: 'string', description: 'Group ID', optional: true },
              },
            },
            createdAt: { type: 'string', description: 'Creation timestamp' },
            updatedAt: { type: 'string', description: 'Last update timestamp' },
          },
        },
      },
      count: { type: 'number', description: 'Total number of secrets returned' },
    },
  }
