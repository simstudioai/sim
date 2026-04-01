import type {
  LaunchDarklyCreateFlagParams,
  LaunchDarklyCreateFlagResponse,
} from '@/tools/launchdarkly/types'
import { FLAG_OUTPUT_PROPERTIES } from '@/tools/launchdarkly/types'
import type { ToolConfig } from '@/tools/types'

export const launchDarklyCreateFlagTool: ToolConfig<
  LaunchDarklyCreateFlagParams,
  LaunchDarklyCreateFlagResponse
> = {
  id: 'launchdarkly_create_flag',
  name: 'LaunchDarkly Create Flag',
  description: 'Create a new feature flag in a LaunchDarkly project.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LaunchDarkly API key',
    },
    projectKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The project key to create the flag in',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Human-readable name for the feature flag',
    },
    key: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique key for the feature flag (used in code)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the feature flag',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of tags',
    },
    temporary: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the flag is temporary (default true)',
    },
  },

  request: {
    url: (params) =>
      `https://app.launchdarkly.com/api/v2/flags/${encodeURIComponent(params.projectKey.trim())}`,
    method: 'POST',
    headers: (params) => ({
      Authorization: params.apiKey.trim(),
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        name: params.name,
        key: params.key,
      }
      if (params.description) body.description = params.description
      if (params.tags) body.tags = params.tags.split(',').map((t) => t.trim())
      if (params.temporary !== undefined) body.temporary = params.temporary
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }))
      return {
        success: false,
        output: {
          key: '',
          name: '',
          kind: '',
          description: null,
          temporary: false,
          archived: false,
          deprecated: false,
          creationDate: 0,
          tags: [],
          variations: [],
          maintainerId: null,
        },
        error: error.message,
      }
    }

    const data = await response.json()
    return {
      success: true,
      output: {
        key: data.key ?? null,
        name: data.name ?? null,
        kind: data.kind ?? null,
        description: data.description ?? null,
        temporary: data.temporary ?? false,
        archived: data.archived ?? false,
        deprecated: data.deprecated ?? false,
        creationDate: data.creationDate ?? null,
        tags: data.tags ?? [],
        variations: data.variations ?? [],
        maintainerId: data.maintainerId ?? null,
      },
    }
  },

  outputs: FLAG_OUTPUT_PROPERTIES,
}
