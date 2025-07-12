import { createLogger } from '@/lib/logs/console-logger'
import type { ToolConfig } from '../types'
import type { XUser, XUserParams, XUserResponse } from './types'

const logger = createLogger('XUserTool')

export const xUserTool: ToolConfig<XUserParams, XUserResponse> = {
  id: 'x_user',
  name: 'X User',
  description: 'Get user profile information',
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
      visibility: 'hidden',
      description: 'X OAuth access token',
    },
    username: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Username to look up (without @ symbol)',
    },
  },

  request: {
    url: (params) => {
      const username = encodeURIComponent(params.username)
      // Keep fields minimal to reduce chance of rate limits
      const userFields = 'description,profile_image_url,verified,public_metrics'

      return `https://api.twitter.com/2/users/by/username/${username}?user.fields=${userFields}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response, params) => {
    // Handle rate limit issues (429 status code)
    if (response.status === 429) {
      logger.warn('X API rate limit exceeded', {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
      })

      // Try to extract rate limit reset time from headers if available
      const resetTime = response.headers.get('x-rate-limit-reset')
      const message = resetTime
        ? `Rate limit exceeded. Please try again after ${new Date(Number.parseInt(resetTime) * 1000).toLocaleTimeString()}.`
        : 'X API rate limit exceeded. Please try again later.'

      throw new Error(message)
    }

    try {
      const responseData = await response.json()
      logger.debug('X API response', {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        responseData,
      })

      // Check if response contains expected data structure
      if (!responseData.data) {
        // If there's an error object in the response
        if (responseData.errors && responseData.errors.length > 0) {
          const error = responseData.errors[0]
          // Remove the square brackets from the error message
          const cleanedMessage = error.detail ? error.detail.replace(/\[(.*?)\]/, '$1') : ''
          throw new Error(
            `X API error: ${cleanedMessage || error.message || JSON.stringify(error)}`
          )
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
    } catch (error) {
      logger.error('Error processing X API response', {
        error,
        status: response.status,
      })
      throw error
    }
  },

  transformError: (error) => {
    if (error.status === 429) {
      return 'X API rate limit exceeded. Please try again later.'
    }
    if (error.title === 'Unauthorized') {
      return 'Invalid or expired access token. Please reconnect your X account.'
    }
    if (error.title === 'Not Found') {
      return 'The specified user was not found.'
    }
    if (error.detail) {
      // Remove the square brackets from the error message if present
      const cleanedDetail = error.detail.replace(/\[(.*?)\]/, '$1')
      return `X API error: ${cleanedDetail}`
    }

    // Extract the message from the error object
    const errorMessage =
      error.message || 'An unexpected error occurred while fetching user data from X'

    if (errorMessage.includes('rate limit')) {
      return 'X API rate limit exceeded. Please try again later or use a different X account.'
    }

    // Clean any brackets from the error message
    return errorMessage.replace(/\[(.*?)\]/g, '$1')
  },
}
