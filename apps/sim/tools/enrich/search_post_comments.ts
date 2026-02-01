import type {
  EnrichSearchPostCommentsParams,
  EnrichSearchPostCommentsResponse,
} from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const searchPostCommentsTool: ToolConfig<
  EnrichSearchPostCommentsParams,
  EnrichSearchPostCommentsResponse
> = {
  id: 'enrich_search_post_comments',
  name: 'Enrich Search Post Comments',
  description: 'Get comments on a LinkedIn post.',
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
      description: 'LinkedIn activity URN (e.g., urn:li:activity:7191163324208705536)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number (starts at 1, default: 1)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.enrich.so/v1/api/search-comments')
      url.searchParams.append('post_urn', params.postUrn.trim())
      if (params.page !== undefined) {
        url.searchParams.append('page', String(params.page))
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

    const comments =
      resultData.data?.map((comment: any) => ({
        activityId: comment.activity_id ?? null,
        commentary: comment.commentary ?? null,
        linkedInUrl: comment.li_url ?? null,
        commenter: {
          profileId: comment.commenter?.profile_id ?? null,
          firstName: comment.commenter?.first_name ?? null,
          lastName: comment.commenter?.last_name ?? null,
          subTitle: comment.commenter?.sub_title ?? comment.commenter?.subTitle ?? null,
          profilePicture:
            comment.commenter?.profile_picture ?? comment.commenter?.profilePicture ?? null,
          backgroundImage:
            comment.commenter?.background_image ?? comment.commenter?.backgroundImage ?? null,
          entityUrn: comment.commenter?.entity_urn ?? comment.commenter?.entityUrn ?? null,
          objectUrn: comment.commenter?.object_urn ?? comment.commenter?.objectUrn ?? null,
          profileType: comment.commenter?.profile_type ?? comment.commenter?.profileType ?? null,
        },
        reactionBreakdown: {
          likes: comment.reaction_breakdown?.likes ?? 0,
          empathy: comment.reaction_breakdown?.empathy ?? 0,
          other: comment.reaction_breakdown?.other ?? 0,
        },
      })) ?? []

    return {
      success: true,
      output: {
        page: resultData.page ?? 1,
        totalPage: resultData.total_page ?? 1,
        count: resultData.num ?? comments.length,
        comments,
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
      description: 'Number of comments returned',
    },
    comments: {
      type: 'array',
      description: 'Comments',
      items: {
        type: 'object',
        properties: {
          activityId: { type: 'string', description: 'Comment activity ID' },
          commentary: { type: 'string', description: 'Comment text' },
          linkedInUrl: { type: 'string', description: 'Link to comment' },
          commenter: {
            type: 'object',
            description: 'Commenter info',
            properties: {
              profileId: { type: 'string', description: 'Profile ID' },
              firstName: { type: 'string', description: 'First name' },
              lastName: { type: 'string', description: 'Last name' },
              subTitle: { type: 'string', description: 'Subtitle/headline' },
              profilePicture: { type: 'string', description: 'Profile picture URL' },
              backgroundImage: { type: 'string', description: 'Background image URL' },
              entityUrn: { type: 'string', description: 'Entity URN' },
              objectUrn: { type: 'string', description: 'Object URN' },
              profileType: { type: 'string', description: 'Profile type' },
            },
          },
          reactionBreakdown: {
            type: 'object',
            description: 'Reactions on the comment',
            properties: {
              likes: { type: 'number', description: 'Number of likes' },
              empathy: { type: 'number', description: 'Number of empathy reactions' },
              other: { type: 'number', description: 'Number of other reactions' },
            },
          },
        },
      },
    },
  },
}
