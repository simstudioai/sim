import type {
  EnrichSearchPostReactionsParams,
  EnrichSearchPostReactionsResponse,
} from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const searchPostReactionsTool: ToolConfig<
  EnrichSearchPostReactionsParams,
  EnrichSearchPostReactionsResponse
> = {
  id: 'enrich_search_post_reactions',
  name: 'Enrich Search Post Reactions',
  description: 'Get reactions on a LinkedIn post with filtering by reaction type.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrich API key',
    },
    postUrn: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'LinkedIn activity URN (e.g., urn:li:activity:7231931952839196672)',
    },
    reactionType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Reaction type filter: all, like, love, celebrate, insightful, or funny (default: all)',
    },
    page: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Page number (starts at 1)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.enrich.so/v1/api/search-reactions')
      url.searchParams.append('post_urn', params.postUrn.trim())
      url.searchParams.append('reaction_type', params.reactionType)
      url.searchParams.append('page', String(params.page))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const resultData = data.data ?? {}

    const reactions =
      resultData.data?.map((reaction: any) => ({
        reactionType: reaction.reaction_type ?? '',
        reactor: {
          name: reaction.reactor?.name ?? null,
          subTitle: reaction.reactor?.sub_title ?? null,
          profileId: reaction.reactor?.profile_id ?? null,
          profilePicture: reaction.reactor?.profile_picture ?? null,
          linkedInUrl: reaction.reactor?.li_url ?? null,
        },
      })) ?? []

    return {
      success: true,
      output: {
        page: resultData.page ?? 1,
        totalPage: resultData.total_page ?? 1,
        count: resultData.num ?? reactions.length,
        reactions,
      },
    }
  },

  outputs: {
    page: {
      type: 'number',
      description: 'Current page number',
    },
    totalPage: {
      type: 'number',
      description: 'Total number of pages',
    },
    count: {
      type: 'number',
      description: 'Number of reactions returned',
    },
    reactions: {
      type: 'array',
      description: 'Reactions',
      items: {
        type: 'object',
        properties: {
          reactionType: { type: 'string', description: 'Type of reaction' },
          reactor: {
            type: 'object',
            description: 'Person who reacted',
            properties: {
              name: { type: 'string', description: 'Name' },
              subTitle: { type: 'string', description: 'Job title' },
              profileId: { type: 'string', description: 'Profile ID' },
              profilePicture: { type: 'string', description: 'Profile picture URL' },
              linkedInUrl: { type: 'string', description: 'LinkedIn URL' },
            },
          },
        },
      },
    },
  },
}
