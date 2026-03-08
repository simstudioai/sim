import type { SlackOpenViewParams, SlackOpenViewResponse } from '@/tools/slack/types'
import { VIEW_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackOpenViewTool: ToolConfig<SlackOpenViewParams, SlackOpenViewResponse> = {
  id: 'slack_open_view',
  name: 'Slack Open View',
  description:
    'Open a modal view in Slack using a trigger_id from an interaction payload. Used to display forms, confirmations, and other interactive modals.',
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
    triggerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Exchange a trigger to post to the user. Obtained from an interaction payload (e.g., slash command, button click)',
    },
    interactivityPointer: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Alternative to trigger_id for posting to user',
    },
    view: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'A view payload object defining the modal. Must include type ("modal"), title, and blocks array',
    },
  },

  request: {
    url: 'https://slack.com/api/views.open',
    method: 'POST',
    headers: (params: SlackOpenViewParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
    body: (params: SlackOpenViewParams) => {
      const body: Record<string, unknown> = {
        view: typeof params.view === 'string' ? JSON.parse(params.view) : params.view,
      }

      if (params.triggerId) {
        body.trigger_id = params.triggerId.trim()
      }

      if (params.interactivityPointer) {
        body.interactivity_pointer = params.interactivityPointer.trim()
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      if (data.error === 'expired_trigger_id') {
        throw new Error(
          'The trigger_id has expired. Trigger IDs are only valid for 3 seconds after the interaction.'
        )
      }
      if (data.error === 'invalid_trigger_id') {
        throw new Error(
          'Invalid trigger_id. Ensure you are using a trigger_id from a valid interaction payload.'
        )
      }
      if (data.error === 'exchanged_trigger_id') {
        throw new Error(
          'This trigger_id has already been used. Each trigger_id can only be used once.'
        )
      }
      if (data.error === 'view_too_large') {
        throw new Error('The view payload is too large. Reduce the number of blocks or content.')
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
      throw new Error(data.error || 'Failed to open view in Slack')
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
      description: 'The opened modal view object',
      properties: VIEW_OUTPUT_PROPERTIES,
    },
  },
}
