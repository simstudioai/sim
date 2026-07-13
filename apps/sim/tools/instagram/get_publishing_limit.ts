import type {
  InstagramGetPublishingLimitParams,
  InstagramGetPublishingLimitResponse,
} from '@/tools/instagram/types'
import {
  bearerHeaders,
  graphUrl,
  type InstagramGraphPage,
  readGraphError,
  readGraphJson,
} from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

interface PublishingLimitData {
  quota_usage?: number
  config?: {
    quota_total?: number
    quota_duration?: number
  }
}

export const instagramGetPublishingLimitTool: ToolConfig<
  InstagramGetPublishingLimitParams,
  InstagramGetPublishingLimitResponse
> = {
  id: 'instagram_get_publishing_limit',
  name: 'Instagram Get Publishing Limit',
  description: 'Check the content publishing rate limit usage for the account',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'instagram',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Instagram API',
    },
    igUserId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Instagram professional account user id (defaults to /me)',
    },
  },

  request: {
    url: (params) => {
      const path = params.igUserId?.trim()
        ? `/${params.igUserId.trim()}/content_publishing_limit`
        : '/me/content_publishing_limit'
      return graphUrl(path, { fields: 'quota_usage,config' })
    },
    method: 'GET',
    headers: (params) => bearerHeaders(params.accessToken),
  },

  transformResponse: async (response): Promise<InstagramGetPublishingLimitResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: { quotaUsage: null, config: null },
        error: await readGraphError(response),
      }
    }

    const data = await readGraphJson<InstagramGraphPage<PublishingLimitData> & PublishingLimitData>(
      response,
      'Instagram publishing limit response'
    )
    const first = Array.isArray(data.data) ? data.data[0] : data

    return {
      success: true,
      output: {
        quotaUsage: first?.quota_usage ?? null,
        config: first?.config
          ? {
              quotaTotal: first.config.quota_total ?? null,
              quotaDuration: first.config.quota_duration ?? null,
            }
          : null,
      },
    }
  },

  outputs: {
    quotaUsage: {
      type: 'number',
      description: 'Number of publishes used in the current window',
      optional: true,
    },
    config: {
      type: 'json',
      description: 'Quota config (quotaTotal, quotaDuration)',
      optional: true,
    },
  },
}
