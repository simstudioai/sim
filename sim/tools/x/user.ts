import { ToolConfig } from '../types'
import { XUser, XUserParams, XUserResponse } from './types'

export const userTool: ToolConfig<XUserParams, XUserResponse> = {
  id: 'x_user',
  name: 'X User',
  description: 'Get user profile information and recent tweets',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'x',
    additionalScopes: ['tweet.read', 'users.read'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      description: 'X OAuth access token',
    },
    username: {
      type: 'string',
      required: true,
      description: 'Username to look up (without @ symbol)',
    },
  },

  request: {
    url: (params) => {
      const username = encodeURIComponent(params.username)
      const userFields = 'description,profile_image_url,verified,public_metrics'

      return `https://api.x.com/2/users/by/username/${username}?user.fields=${userFields}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response, params) => {
    if (!params) {
      throw new Error('Missing required parameters')
    }

    const responseData = await response.json()

    // Check if response contains expected data structure
    if (!responseData.data) {
      // If there's an error object in the response
      if (responseData.errors && responseData.errors.length > 0) {
        const error = responseData.errors[0]
        throw new Error(error.detail || error.message || 'Failed to fetch user data')
      }
      throw new Error('Invalid response format from X API')
    }

    const userData = responseData.data

    // Create the base user object with defensive coding for missing properties
    const user: XUser = {
      id: userData.id,
      username: userData.username,
      name: userData.name || '',
      description: userData.description || '',
      profileImageUrl: userData.profile_image_url || '',
      verified: !!userData.verified,
      metrics: {
        followersCount: userData.public_metrics?.followers_count || 0,
        followingCount: userData.public_metrics?.following_count || 0,
        tweetCount: userData.public_metrics?.tweet_count || 0,
      },
    }

    return {
      success: true,
      output: {
        user,
      },
    }
  },

  transformError: (error) => {
    if (error.title === 'Unauthorized') {
      return 'Invalid or expired access token. Please reconnect your X account.'
    }
    if (error.title === 'Not Found') {
      return 'The specified user was not found.'
    }
    if (error.detail) {
      return `X API error: ${error.detail}`
    }
    return error.message || 'An unexpected error occurred while fetching user data from X'
  },
}
