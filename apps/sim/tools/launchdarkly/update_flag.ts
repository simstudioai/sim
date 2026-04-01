import type {
  LaunchDarklyUpdateFlagParams,
  LaunchDarklyUpdateFlagResponse,
} from '@/tools/launchdarkly/types'
import { FLAG_OUTPUT_PROPERTIES } from '@/tools/launchdarkly/types'
import type { ToolConfig } from '@/tools/types'

export const launchDarklyUpdateFlagTool: ToolConfig<
  LaunchDarklyUpdateFlagParams,
  LaunchDarklyUpdateFlagResponse
> = {
  id: 'launchdarkly_update_flag',
  name: 'LaunchDarkly Update Flag',
  description:
    'Update a feature flag metadata (name, description, tags, temporary, archived) using semantic patch.',
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
      description: 'The project key',
    },
    flagKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The feature flag key to update',
    },
    updateName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the flag',
    },
    updateDescription: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New description for the flag',
    },
    addTags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tags to add',
    },
    removeTags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tags to remove',
    },
    archive: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to true to archive, false to restore',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional comment explaining the update',
    },
  },

  request: {
    url: (params) =>
      `https://app.launchdarkly.com/api/v2/flags/${encodeURIComponent(params.projectKey.trim())}/${encodeURIComponent(params.flagKey.trim())}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: params.apiKey.trim(),
      'Content-Type': 'application/json; domain-model=launchdarkly.semanticpatch',
    }),
    body: (params) => {
      const instructions: Array<Record<string, unknown>> = []

      if (params.updateName) {
        instructions.push({ kind: 'updateName', value: params.updateName })
      }
      if (params.updateDescription) {
        instructions.push({ kind: 'updateDescription', value: params.updateDescription })
      }
      if (params.addTags) {
        instructions.push({
          kind: 'addTags',
          values: params.addTags.split(',').map((t: string) => t.trim()),
        })
      }
      if (params.removeTags) {
        instructions.push({
          kind: 'removeTags',
          values: params.removeTags.split(',').map((t: string) => t.trim()),
        })
      }
      if (params.archive === true) {
        instructions.push({ kind: 'archiveFlag' })
      } else if (params.archive === false) {
        instructions.push({ kind: 'restoreFlag' })
      }

      if (instructions.length === 0) {
        throw new Error(
          'At least one update field must be provided (updateName, updateDescription, addTags, removeTags, or archive)'
        )
      }

      const body: Record<string, unknown> = { instructions }
      if (params.comment) body.comment = params.comment

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
