import type {
  TinyFishListProfilesParams,
  TinyFishListProfilesResponse,
  TinyFishRawProfile,
  TinyFishRawProfiles,
} from '@/tools/tinyfish/types'
import {
  TINYFISH_AGENT_API_BASE,
  tinyfishErrorMessage,
  tinyfishHeaders,
} from '@/tools/tinyfish/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Reads the profile array out of the list payload.
 *
 * TinyFish publishes no example response for `GET /v1/profiles`, so all three
 * shapes a list endpoint plausibly returns are accepted rather than betting on
 * one: a bare array, and the `profiles` and `data` envelopes its other list
 * endpoints use.
 */
function extractProfiles(data: TinyFishRawProfiles | TinyFishRawProfile[]): TinyFishRawProfile[] {
  if (Array.isArray(data)) return data
  return data?.profiles ?? data?.data ?? []
}

/**
 * Lists the Browser Context Profiles saved on the TinyFish account.
 *
 * A profile carries logged-in browser state, so this returns the ids a run
 * selects with `profileId` — never the cookies or storage behind them. Profiles
 * are created and logged into through TinyFish's own setup-session flow, which
 * hands a live CDP URL to a browser driver and cannot run inside a block.
 */
export const listProfilesTool: ToolConfig<
  TinyFishListProfilesParams,
  TinyFishListProfilesResponse
> = {
  id: 'tinyfish_list_profiles',
  name: 'TinyFish List Browser Profiles',
  description:
    'List the Browser Context Profiles saved on the TinyFish account, with the ids an agent run can start from to reuse a logged-in session',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'TinyFish API key',
    },
  },

  request: {
    url: `${TINYFISH_AGENT_API_BASE}/v1/profiles`,
    method: 'GET',
    headers: (params) => tinyfishHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await tinyfishErrorMessage(response))
    }

    const data = (await response.json()) as TinyFishRawProfiles | TinyFishRawProfile[]

    return {
      success: true,
      output: {
        profiles: extractProfiles(data).map((profile) => ({
          profileId: profile?.id ?? '',
          name: profile?.name ?? '',
          proxyCountryCode: profile?.proxy_country_code ?? null,
          fingerprintSeed: profile?.fingerprint_seed ?? null,
          createdAt: profile?.created_at ?? null,
          isDefault: profile?.set_as_default ?? profile?.is_default ?? null,
        })),
      },
    }
  },

  outputs: {
    profiles: {
      type: 'array',
      description: 'Browser Context Profiles an agent run can start from',
      items: {
        type: 'object',
        properties: {
          profileId: {
            type: 'string',
            description: 'Profile identifier, used as the Browser Profile ID on a run',
          },
          name: { type: 'string', description: 'Profile name, such as "Salesforce Production"' },
          proxyCountryCode: {
            type: 'string',
            description: 'Country the profile proxies through, null when it has no proxy',
            optional: true,
          },
          fingerprintSeed: {
            type: 'string',
            description: 'Seed for the browser fingerprint the profile replays',
            optional: true,
          },
          createdAt: {
            type: 'string',
            description: 'ISO 8601 timestamp when the profile was created',
            optional: true,
          },
          isDefault: {
            type: 'boolean',
            description:
              'Whether runs with no Browser Profile ID use this one, null when the API does not report it',
            optional: true,
          },
        },
      },
    },
  },
}
