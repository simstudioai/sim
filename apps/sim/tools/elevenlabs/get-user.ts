import type { ElevenLabsGetUserParams, ElevenLabsGetUserResponse } from '@/tools/elevenlabs/types'
import type { ToolConfig } from '@/tools/types'

export const elevenLabsGetUserTool: ToolConfig<ElevenLabsGetUserParams, ElevenLabsGetUserResponse> =
  {
    id: 'elevenlabs_get_user',
    name: 'ElevenLabs Get User',
    description: 'Get account and subscription information for the ElevenLabs user',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Your ElevenLabs API key',
      },
    },

    request: {
      url: 'https://api.elevenlabs.io/v1/user',
      method: 'GET',
      headers: (params) => ({
        'xi-api-key': params.apiKey,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      const subscription = data.subscription
      return {
        success: true,
        output: {
          userId: data.user_id ?? null,
          isNewUser: data.is_new_user ?? null,
          subscription: subscription
            ? {
                tier: subscription.tier ?? null,
                characterCount: subscription.character_count ?? null,
                characterLimit: subscription.character_limit ?? null,
                canExtendCharacterLimit: subscription.can_extend_character_limit ?? null,
                status: subscription.status ?? null,
                nextCharacterCountResetUnix: subscription.next_character_count_reset_unix ?? null,
              }
            : null,
        },
      }
    },

    outputs: {
      userId: { type: 'string', description: 'Unique user identifier' },
      isNewUser: { type: 'boolean', description: 'Whether the user is new' },
      subscription: {
        type: 'object',
        description: 'Subscription and usage details',
        properties: {
          tier: { type: 'string', description: 'Subscription tier' },
          characterCount: { type: 'number', description: 'Characters used this period' },
          characterLimit: { type: 'number', description: 'Character quota for this period' },
          canExtendCharacterLimit: {
            type: 'boolean',
            description: 'Whether the character limit can be extended',
          },
          status: { type: 'string', description: 'Subscription status' },
          nextCharacterCountResetUnix: {
            type: 'number',
            description: 'Unix timestamp when the character count resets',
          },
        },
      },
    },
  }
