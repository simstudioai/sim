import { ToolConfig, ToolResponse } from '../types'

// Define the response type for Mem0 tools
export interface Mem0Response extends ToolResponse {
  output: {
    ids?: string[]
    memories?: any[]
    searchResults?: any[]
  }
}

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
      let messagesArray = params.messages;
      if (typeof messagesArray === 'string') {
        try {
          messagesArray = JSON.parse(messagesArray);
        } catch (e) {
          console.error('Error parsing messages:', e);
          throw new Error('Messages must be a valid JSON array of objects with role and content');
        }
      }

      // Validate message format
      if (!Array.isArray(messagesArray) || messagesArray.length === 0) {
        console.error('Invalid message format:', messagesArray);
        throw new Error('Messages must be a non-empty array');
      }

      for (const msg of messagesArray) {
        if (!msg.role || !msg.content) {
          console.error('Invalid message object:', msg);
          throw new Error('Each message must have role and content properties');
        }
      }

      // Prepare request body
      const body: Record<string, any> = {
        messages: messagesArray,
        user_id: params.userId,
        version: params.version || 'v2'
      }

      // Log the request payload for debugging
      console.log('Mem0 Add Memories request payload:', JSON.stringify(body, null, 2));
      
      return body;
    },
  },
  transformResponse: async (response) => {
    const data = await response.json();
    console.log('Mem0 API response:', JSON.stringify(data, null, 2));
    
    // If the API returns an empty array, this might be normal behavior on success
    if (Array.isArray(data) && data.length === 0) {
      console.log('Memory was added, but API returned empty array');
      return {
        success: true,
        output: {
          memories: [],
        },
      };
    }
    
    // Handle array response with memory objects
    if (Array.isArray(data) && data.length > 0) {
      // Extract IDs for easy access
      const memoryIds = data.map(memory => memory.id);
      console.log('Memory IDs:', memoryIds);
      
      return {
        success: true,
        output: {
          ids: memoryIds,
          memories: data,
        },
      };
    }
    
    // Handle non-array responses (single memory object)
    if (data && !Array.isArray(data) && data.id) {
      console.log('Memory API returned single object with ID:', data.id);
      return {
        success: true,
        output: {
          ids: [data.id],
          memories: [data],
        },
      };
    }
    
    // Default response format if none of the above match
    return {
      success: true,
      output: {
        memories: Array.isArray(data) ? data : [data],
      },
    };
  },
  transformError: async (error) => {
    console.error('Mem0 API error:', error);
    
    // If error has a response, try to extract more details
    if (error.response) {
      try {
        const errorData = await error.response.json();
        console.error('Mem0 API error details:', JSON.stringify(errorData, null, 2));
        console.log(`Failed to add memories to Mem0: ${JSON.stringify(errorData)}`);
      } catch (e) {
        // If we can't parse the response, return the status text
        console.log(`Failed to add memories to Mem0: ${error.response.status} - ${error.response.statusText || error.message}`);
      }
    }
    
    return {
      success: false,
      output: {
        ids: [],
        memories: [],
      }
    };
  },
}

// Search Memories Tool
export const mem0SearchMemoriesTool: ToolConfig = {
  id: 'mem0_search_memories',
  name: 'Search Memories',
  description: 'Search for memories in Mem0 using semantic search',
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
      description: 'User ID to search memories for',
    },
    query: {
      type: 'string',
      required: true,
      description: 'Search query to find relevant memories',
    },
    limit: {
      type: 'number',
      required: false,
      default: 10,
      description: 'Maximum number of results to return',
    },
    version: {
      type: 'string',
      required: false,
      default: 'v2',
      description: 'API version to use (v1 or v2). Use v2 if unsure.',
    },
  },
  request: {
    url: 'https://api.mem0.ai/v2/memories/search/',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Token ${params.apiKey}`,
    }),
    body: (params) => {
      try {
        // Log all parameters for debugging
        console.log('All search params:', JSON.stringify(params, null, 2));
        
        // Create the request body with the format that the curl test confirms works
        const body: Record<string, any> = {
          query: params.query || "test",
          filters: {
            user_id: params.userId
          },
          top_k: params.limit || 10
        };
        
        // Log the final request payload
        console.log('Final search request payload:', JSON.stringify(body, null, 2));
        return body;
      } catch (error) {
        console.error('Error building search request:', error);
        throw error;
      }
    },
  },
  transformResponse: async (response) => {
    try {
      // Get raw response for debugging
      const responseText = await response.clone().text();
      console.log('Raw API response:', responseText);
      
      // Parse the response
      const data = JSON.parse(responseText);
      console.log('Parsed API response:', JSON.stringify(data, null, 2));
      
      // Handle empty results
      if (!data || (Array.isArray(data) && data.length === 0)) {
        return {
          success: true,
          output: {
            searchResults: [],
            ids: [],
          }
        };
      }
      
      // For array results (standard format)
      if (Array.isArray(data)) {
        const searchResults = data.map(item => ({
          id: item.id,
          data: { memory: item.memory || "" },
          score: item.score || 0
        }));
        
        const ids = data.map(item => item.id).filter(Boolean);
        
        return {
          success: true,
          output: {
            searchResults,
            ids,
          }
        };
      }
      
      // Fallback for unexpected response format
      return {
        success: true,
        output: {
          searchResults: [],
        }
      };
    } catch (error: any) {
      console.error('Error processing search response:', error);
      return {
        success: false,
        output: {
          error: `Failed to process search response: ${error.message}`,
        }
      };
    }
  },
  transformError: async (error) => {
    console.error('API error details:', error);
    
    if (error.response) {
      try {
        const errorText = await error.response.text();
        console.error('API error response text:', errorText);
        
        try {
          const errorData = JSON.parse(errorText);
          console.error(`API Error: ${JSON.stringify(errorData)}`);
        } catch {
          console.error(`API Error: ${error.response.status} - ${errorText || error.message}`);
        }
      } catch {
        console.error(`API Error: ${error.response.status} - ${error.message || 'Unknown error'}`);
      }
    } else if (error.message) {
      console.error(error.message);
    }
    
    return {
      success: false,
      output: {
        ids: [],
        searchResults: [],
      }
    };
  },
}

// Get Memories Tool
export const mem0GetMemoriesTool: ToolConfig = {
  id: 'mem0_get_memories',
  name: 'Get Memories',
  description: 'Retrieve memories from Mem0 by ID or filter criteria',
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
      description: 'User ID to retrieve memories for',
    },
    memoryId: {
      type: 'string',
      required: false,
      description: 'Specific memory ID to retrieve',
    },
    startDate: {
      type: 'string',
      required: false,
      description: 'Start date for filtering by created_at (format: YYYY-MM-DD)',
    },
    endDate: {
      type: 'string',
      required: false,
      description: 'End date for filtering by created_at (format: YYYY-MM-DD)',
    },
    limit: {
      type: 'number',
      required: false,
      default: 10,
      description: 'Maximum number of results to return',
    },
    version: {
      type: 'string',
      required: false,
      default: 'v2',
      description: 'API version to use (v1 or v2). Use v2 if unsure.',
    },
  },
  request: {
    url: (params) => {
      // For a specific memory ID, use the get single memory endpoint
      if (params.memoryId) {
        return `https://api.mem0.ai/v1/memories/${params.memoryId}/`
      }
      // Otherwise use v2 memories endpoint with filters
      return 'https://api.mem0.ai/v2/memories/';
    },
    method: 'POST', // Default to POST, which is used for the v2 filtering endpoint
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Token ${params.apiKey}`,
    }),
    body: (params: Record<string, any>) => {
      // For specific memory ID, we'll use GET method instead and don't need a body
      // But we still need to return an empty object to satisfy the type
      if (params.memoryId) {
        return {};
      }
      
      console.log('Get memories params:', JSON.stringify(params, null, 2));
      
      // Build filters array for AND condition
      const andConditions = [];
      
      // Add user filter
      andConditions.push({ "user_id": params.userId });
      
      // Add date range filter if provided
      if (params.startDate || params.endDate) {
        const dateFilter: Record<string, any> = {};
        
        if (params.startDate) {
          dateFilter.gte = params.startDate;
        }
        
        if (params.endDate) {
          dateFilter.lte = params.endDate;
        }
        
        andConditions.push({ "created_at": dateFilter });
      }
      
      // Build final filters object
      const body: Record<string, any> = {
        page_size: params.limit || 10
      };
      
      // Only add filters if we have any conditions
      if (andConditions.length > 0) {
        body.filters = { "AND": andConditions };
      }
      
      console.log('Get memories request body:', JSON.stringify(body, null, 2));
      return body;
    },
  },
  transformResponse: async (response, params) => {
    try {
      // Get raw response for debugging
      const responseText = await response.clone().text();
      console.log('Raw Get Memories API response:', responseText);
      
      // Parse the response
      const data = JSON.parse(responseText);
      console.log('Parsed Get Memories API response:', JSON.stringify(data, null, 2));
      
      // Format the memories for display
      const memories = Array.isArray(data) ? data : [data];
      
      // Extract IDs if available
      const ids = memories.map(memory => memory.id).filter(Boolean);
      
      return {
        success: true,
        output: {
          memories,
          ids,
        },
      };
    } catch (error: any) {
      console.error('Error processing get memories response:', error);
      return {
        success: false,
        output: {
          error: `Failed to process get memories response: ${error.message}`,
        }
      };
    }
  },
  transformError: async (error) => {
    console.error('API error details:', error);
    
    if (error.response) {
      try {
        const errorText = await error.response.text();
        console.error('API error response text:', errorText);
        
        try {
          const errorData = JSON.parse(errorText);
          console.error(`API Error: ${JSON.stringify(errorData)}`);
        } catch {
          console.error(`API Error: ${error.response.status} - ${errorText || error.message}`);
        }
      } catch {
        console.error(`API Error: ${error.response.status} - ${error.message || 'Unknown error'}`);
      }
    } else if (error.message) {
      console.error(error.message);
    }
    
    return {
      success: false,
      output: {
        ids: [],
        memories: [],
      }
    };
  },
} 