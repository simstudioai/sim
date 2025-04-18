import { ToolConfig } from "../types"

// Add Memories Tool
export const mem0AddMemoriesTool: ToolConfig = {
    id: 'mem0_add_memories',
    name: 'Add Memories',
    description: 'Add memories to Mem0 for persistent storage and retrieval',
    version: '1.0.0',
    params: {
      apiKey: {
        type: 'string',
        required: true,
        description: 'Your Mem0 API key',
      },
      userId: {
        type: 'string',
        required: true,
        description: 'User ID associated with the memory',
      },
      messages: {
        type: 'json',
        required: true,
        description: 'Array of message objects with role and content',
      },
      version: {
        type: 'string',
        required: false,
        default: 'v2',
        description: 'API version to use (v1 or v2). Use v2 if unsure.',
      },
    },
    request: {
      url: 'https://api.mem0.ai/v1/memories/',
      method: 'POST',
      headers: (params) => ({
        'Content-Type': 'application/json',
        Authorization: `Token ${params.apiKey}`,
      }),
      body: (params) => {
        // First, ensure messages is an array
        let messagesArray = params.messages
        if (typeof messagesArray === 'string') {
          try {
            messagesArray = JSON.parse(messagesArray)
          } catch (e) {
            throw new Error('Messages must be a valid JSON array of objects with role and content')
          }
        }
  
        // Validate message format
        if (!Array.isArray(messagesArray) || messagesArray.length === 0) {
          throw new Error('Messages must be a non-empty array')
        }
  
        for (const msg of messagesArray) {
          if (!msg.role || !msg.content) {
            throw new Error('Each message must have role and content properties')
          }
        }
  
        // Prepare request body
        const body: Record<string, any> = {
          messages: messagesArray,
          user_id: params.userId,
          version: params.version || 'v2'
        }
        
        return body
      },
    },
    transformResponse: async (response) => {
      const data = await response.json()
      
      // If the API returns an empty array, this might be normal behavior on success
      if (Array.isArray(data) && data.length === 0) {
        return {
          success: true,
          output: {
            memories: [],
          },
        }
      }
      
      // Handle array response with memory objects
      if (Array.isArray(data) && data.length > 0) {
        // Extract IDs for easy access
        const memoryIds = data.map(memory => memory.id)
        
        return {
          success: true,
          output: {
            ids: memoryIds,
            memories: data,
          },
        }
      }
      
      // Handle non-array responses (single memory object)
      if (data && !Array.isArray(data) && data.id) {
        return {
          success: true,
          output: {
            ids: [data.id],
            memories: [data],
          },
        }
      }
      
      // Default response format if none of the above match
      return {
        success: true,
        output: {
          memories: Array.isArray(data) ? data : [data],
        },
      }
    },
    transformError: async (error) => {
      return {
        success: false,
        output: {
          ids: [],
          memories: [],
        }
      }
    },
  }