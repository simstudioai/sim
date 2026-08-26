import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type {
  LinkedInProfileOutput,
  ProfileIdExtractor,
  SharePostParams,
  SharePostResponse,
} from '@/tools/linkedin/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('LinkedInSharePost')

/**
 * LinkedIn's documented permalink prefix for a `urn:li:ugcPost:` URN — the family `/v2/ugcPosts`
 * returns. LinkedIn describes the resulting URL as viewable by an authorized member, not as a
 * guaranteed public permalink.
 */
const LINKEDIN_FEED_UPDATE_BASE = 'https://www.linkedin.com/feed/update/'

/**
 * A LinkedIn URN — `urn:li:<entityType>:<id>`. `x-restli-id` is a response header, so its value is
 * server-controlled: interpolating it unchecked would turn anything LinkedIn ever puts there into
 * a `feed/update/<junk>/` link that looks canonical but resolves nowhere. `postUrl` is only built
 * when the header actually carries a URN; `postId` still reports the raw header value.
 */
const LINKEDIN_URN_PATTERN = /^urn:li:[A-Za-z][A-Za-z0-9]*:[^\s/]+$/

// Helper function to extract profile ID from various response formats
const extractProfileId: ProfileIdExtractor = (output: unknown): string | null => {
  if (typeof output === 'object' && output !== null) {
    const profileOutput = output as LinkedInProfileOutput
    return profileOutput.profile?.id || profileOutput.sub || profileOutput.id || null
  }
  return null
}

export const linkedInSharePostTool: ToolConfig<SharePostParams, SharePostResponse> = {
  id: 'linkedin_share_post',
  name: 'Share Post on LinkedIn',
  description: 'Share a post to your personal LinkedIn feed',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linkedin',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for LinkedIn API',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The text content of your LinkedIn post',
    },
    visibility: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Who can see this post: "PUBLIC" (anyone on LinkedIn), "CONNECTIONS" (1st-degree connections only), or "LOGGED_IN" (signed-in LinkedIn members only). Default: "PUBLIC"',
    },
  },

  // First request: Get user profile to obtain the person URN
  request: {
    url: () => 'https://api.linkedin.com/v2/userinfo',
    method: 'GET',
    headers: (params: SharePostParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'X-Restli-Protocol-Version': '2.0.0',
    }),
  },

  // Use postProcess to make the actual post creation request
  postProcess: async (profileResult, params, executeTool) => {
    try {
      // Extract profile from the first request
      if (!profileResult.success || !profileResult.output) {
        return {
          success: false,
          output: {},
          error: 'Failed to fetch user profile',
        }
      }

      // Get profile data from output
      const profileOutput = profileResult.output as LinkedInProfileOutput
      const authorId = extractProfileId(profileOutput)

      if (!authorId) {
        return {
          success: false,
          output: {},
          error: 'Could not extract LinkedIn profile ID from response',
        }
      }

      const authorUrn = `urn:li:person:${authorId}`

      // Create the post
      const postData = {
        author: authorUrn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: {
              text: params.text,
            },
            shareMediaCategory: 'NONE',
          },
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': params.visibility || 'PUBLIC',
        },
      }

      const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(postData),
      })

      if (!response.ok) {
        const error = await response.text()
        return {
          success: false,
          output: {},
          error: `LinkedIn API error: ${error}`,
        }
      }

      const postId = response.headers.get('x-restli-id') ?? undefined
      const postUrn = postId && LINKEDIN_URN_PATTERN.test(postId) ? postId : undefined

      if (postId && !postUrn) {
        logger.warn(
          'LinkedIn returned an x-restli-id that is not a urn:li: URN; reporting the raw id without a post URL',
          { status: response.status }
        )
      }

      if (!postId) {
        logger.warn(
          'LinkedIn returned a success status for ugcPosts without the x-restli-id header; the post was created but its id is unavailable',
          { status: response.status }
        )
      }

      return {
        success: true,
        output: {
          postId,
          postUrl: postUrn ? `${LINKEDIN_FEED_UPDATE_BASE}${postUrn}/` : undefined,
        },
      }
    } catch (error) {
      return {
        success: false,
        output: {},
        error: getErrorMessage(error, 'Unknown error'),
      }
    }
  },

  outputs: {
    postId: {
      type: 'string',
      description:
        'The `urn:li:ugcPost:` URN of the created post, read from the `x-restli-id` response header. Absent when LinkedIn omits that header.',
      optional: true,
    },
    postUrl: {
      type: 'string',
      description:
        'LinkedIn URL of the created post. Viewable by an authorized LinkedIn member — not a guaranteed public permalink. Absent when the `x-restli-id` header was missing or did not carry a `urn:li:` URN of the ugcPost family.',
      optional: true,
    },
  },

  transformResponse: async (response: Response): Promise<SharePostResponse> => {
    // This handles the initial profile fetch response
    if (!response.ok) {
      return {
        success: false,
        output: {},
        error: `Failed to fetch profile: ${response.statusText}`,
      }
    }

    const profile = await response.json()

    // Return profile data for postProcess to use
    return {
      success: true,
      output: profile,
    }
  },
}
