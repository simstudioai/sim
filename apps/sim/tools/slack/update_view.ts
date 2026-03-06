import type { SlackUpdateViewParams, SlackUpdateViewResponse } from '@/tools/slack/types'
import { VIEW_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackUpdateViewTool: ToolConfig<SlackUpdateViewParams, SlackUpdateViewResponse> = {
  id: 'slack_update_view',
  name: 'Slack Update View',
  description:
    'Update an existing modal view in Slack. Identify the view by view_id or external_id, and provide the updated view payload.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'slack',
  },

  params: {
    authMethod: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Authentication method: oauth or bot_token',
    },
    botToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Bot token for Custom Bot',
    },
    accessToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'OAuth access token or bot token for Slack API',
    },
    viewId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Unique identifier of the view to update. Either viewId or externalId is required',
    },
    externalId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Developer-set unique identifier of the view to update (max 255 chars). Either viewId or externalId is required',
    },
    hash: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'View state hash to protect against race conditions. Obtained from a previous views response',
    },
    view: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'A view payload object defining the updated modal. Must include type ("modal"), title, and blocks array. Use identical block_id and action_id values to preserve input data',
    },
  },

  request: {
    url: 'https://slack.com/api/views.update',
    method: 'POST',
    headers: (params: SlackUpdateViewParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
    body: (params: SlackUpdateViewParams) => {
      const body: Record<string, unknown> = {
        view: typeof params.view === 'string' ? JSON.parse(params.view) : params.view,
      }

      if (params.viewId) {
        body.view_id = params.viewId.trim()
      }

      if (params.externalId) {
        body.external_id = params.externalId.trim()
      }

      if (params.hash) {
        body.hash = params.hash.trim()
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      if (data.error === 'not_found') {
        throw new Error(
          'View not found. The provided view_id or external_id does not match an existing view.'
        )
      }
      if (data.error === 'hash_conflict') {
        throw new Error(
          'The view has been modified since the hash was generated. Retrieve the latest view and try again.'
        )
      }
      if (data.error === 'view_too_large') {
        throw new Error(
          'The view payload is too large (max 250kb). Reduce the number of blocks or content.'
        )
      }
      if (data.error === 'duplicate_external_id') {
        throw new Error(
          'A view with this external_id already exists. Use a unique external_id per workspace.'
        )
      }
      if (data.error === 'invalid_arguments') {
        const messages = data.response_metadata?.messages ?? []
        throw new Error(
          `Invalid view arguments: ${messages.length > 0 ? messages.join(', ') : data.error}`
        )
      }
      if (data.error === 'missing_scope') {
        throw new Error(
          'Missing required permissions. Please reconnect your Slack account with the necessary scopes.'
        )
      }
      if (
        data.error === 'invalid_auth' ||
        data.error === 'not_authed' ||
        data.error === 'token_expired'
      ) {
        throw new Error('Invalid authentication. Please check your Slack credentials.')
      }
      throw new Error(data.error || 'Failed to update view in Slack')
    }

    const view = data.view

    return {
      success: true,
      output: {
        view: {
          id: view.id,
          team_id: view.team_id ?? null,
          type: view.type,
          title: view.title ?? null,
          submit: view.submit ?? null,
          close: view.close ?? null,
          blocks: view.blocks ?? [],
          private_metadata: view.private_metadata ?? null,
          callback_id: view.callback_id ?? null,
          external_id: view.external_id ?? null,
          state: view.state ?? null,
          hash: view.hash ?? null,
          clear_on_close: view.clear_on_close ?? false,
          notify_on_close: view.notify_on_close ?? false,
          root_view_id: view.root_view_id ?? null,
          previous_view_id: view.previous_view_id ?? null,
          app_id: view.app_id ?? null,
          bot_id: view.bot_id ?? null,
        },
      },
    }
  },

  outputs: {
    view: {
      type: 'object',
      description: 'The updated modal view object',
      properties: VIEW_OUTPUT_PROPERTIES,
    },
  },
}
