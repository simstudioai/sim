import type {
  EnrichSearchCompanyActivitiesParams,
  EnrichSearchCompanyActivitiesResponse,
} from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const searchCompanyActivitiesTool: ToolConfig<
  EnrichSearchCompanyActivitiesParams,
  EnrichSearchCompanyActivitiesResponse
> = {
  id: 'enrich_search_company_activities',
  name: 'Enrich Search Company Activities',
  description: "Get a company's LinkedIn activities (posts, comments, or articles) by company ID.",
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrich API key',
    },
    companyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'LinkedIn company ID',
    },
    activityType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Activity type: posts, comments, or articles',
    },
    paginationToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token for next page of results',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of records to skip (default: 0)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.enrich.so/v1/api/search-company-activities')
      url.searchParams.append('company_id', params.companyId.trim())
      url.searchParams.append('activity_type', params.activityType)
      if (params.paginationToken) {
        url.searchParams.append('pagination_token', params.paginationToken)
      }
      if (params.offset !== undefined) {
        url.searchParams.append('offset', String(params.offset))
      }
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

    const activities =
      resultData.data?.map((activity: any) => ({
        activityId: activity.activity_id ?? null,
        commentary: activity.commentary ?? null,
        linkedInUrl: activity.li_url ?? null,
        timeElapsed: activity.time_elapsed ?? null,
        numReactions: activity.num_reactions ?? activity.numReactions ?? null,
        author: activity.author
          ? {
              name: activity.author.name ?? null,
              // API returns 'id' (integer) for company activities, 'profile_id' for people activities
              profileId: String(
                activity.author.id ?? activity.author.profile_id ?? activity.author.profileId ?? ''
              ),
              // API returns 'logo_url' for company activities, 'profile_picture' for people activities
              profilePicture:
                activity.author.logo_url ??
                activity.author.profile_picture ??
                activity.author.profilePicture ??
                null,
            }
          : null,
        reactionBreakdown: {
          likes: activity.reaction_breakdown?.likes ?? 0,
          empathy: activity.reaction_breakdown?.empathy ?? 0,
          other: activity.reaction_breakdown?.other ?? 0,
        },
        attachments: activity.attachments ?? [],
      })) ?? []

    return {
      success: true,
      output: {
        paginationToken: resultData.pagination_token ?? null,
        activityType: resultData.activity_type ?? '',
        activities,
      },
    }
  },

  outputs: {
    paginationToken: {
      type: 'string',
      description: 'Token for fetching next page',
      optional: true,
    },
    activityType: {
      type: 'string',
      description: 'Type of activities returned',
    },
    activities: {
      type: 'array',
      description: 'Activities',
      items: {
        type: 'object',
        properties: {
          activityId: { type: 'string', description: 'Activity ID' },
          commentary: { type: 'string', description: 'Activity text content' },
          linkedInUrl: { type: 'string', description: 'Link to activity' },
          timeElapsed: { type: 'string', description: 'Time elapsed since activity' },
          numReactions: { type: 'number', description: 'Total number of reactions' },
          author: {
            type: 'object',
            description: 'Activity author info',
            properties: {
              name: { type: 'string', description: 'Author name' },
              profileId: { type: 'string', description: 'Profile ID' },
              profilePicture: { type: 'string', description: 'Profile picture URL' },
            },
          },
          reactionBreakdown: {
            type: 'object',
            description: 'Reactions',
            properties: {
              likes: { type: 'number', description: 'Likes' },
              empathy: { type: 'number', description: 'Empathy reactions' },
              other: { type: 'number', description: 'Other reactions' },
            },
          },
          attachments: { type: 'array', description: 'Attachments' },
        },
      },
    },
  },
}
