import type {
  LinkedInProfileOutput,
  ProfileIdExtractor,
  SharePostParams,
  SharePostResponse,
} from '@/tools/linkedin/types'
import type { ToolConfig } from '@/tools/types'

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
      description: 'Who can see this post: "PUBLIC" or "CONNECTIONS" (default: "PUBLIC")',
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

      const result = await response.json()

      return {
        success: true,
        output: {
          postId: result.id,
        },
      }
    } catch (error) {
      return {
        success: false,
        output: {},
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
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
