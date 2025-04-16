import { ToolConfig } from "../types";

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