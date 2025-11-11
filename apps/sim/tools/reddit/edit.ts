import type { RedditEditParams, RedditWriteResponse } from '@/tools/reddit/types'
import type { ToolConfig } from '@/tools/types'

export const editTool: ToolConfig<RedditEditParams, RedditWriteResponse> = {
  id: 'reddit_edit',
  name: 'Edit Reddit Post/Comment',
  description: 'Edit the text of your own Reddit post or comment',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'reddit',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Reddit API',
    },
    thing_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Thing fullname to edit (e.g., t3_xxxxx for post, t1_xxxxx for comment)',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New text content in markdown format',
    },
  },

  request: {
    url: () => 'https://oauth.reddit.com/api/editusertext',
    method: 'POST',
    headers: (params: RedditEditParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: (params: RedditEditParams) => {
      const formData = new URLSearchParams({
        thing_id: params.thing_id,
        text: params.text,
        api_type: 'json',
      })

      return formData.toString() as unknown as Record<string, any>
    },
  },

  transformResponse: async (response: Response, requestParams?: RedditEditParams) => {
    const data = await response.json()

    // Reddit API returns errors in json.errors array
    if (data.json?.errors && data.json.errors.length > 0) {
      const errors = data.json.errors.map((err: any) => err.join(': ')).join(', ')
      return {
        success: false,
        output: {
          success: false,
          message: `Failed to edit: ${errors}`,
        },
      }
    }

    // Success response
    const thingData = data.json?.data?.things?.[0]?.data
    return {
      success: true,
      output: {
        success: true,
        message: `Successfully edited ${requestParams?.thing_id}`,
        data: {
          id: thingData?.id,
          body: thingData?.body,
          selftext: thingData?.selftext,
        },
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the edit was successful',
    },
    message: {
      type: 'string',
      description: 'Success or error message',
    },
    data: {
      type: 'object',
      description: 'Updated content data',
    },
  },
}
