import { Mem0Icon } from '@/components/icons'
import { BlockConfig } from '../types'
import { Mem0Response } from '@/tools/mem0'

export const Mem0Block: BlockConfig<Mem0Response> = {
  type: 'mem0',
  name: 'Mem0',
  description: 'Memory Management',
  longDescription:
    'Add, search, retrieve, and delete memories using Mem0. Store conversation history, user preferences, and context across workflow executions for enhanced AI agent capabilities.',
  bgColor: '#8B5CF6',
  icon: Mem0Icon,
  category: 'tools',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Add Memories', id: 'add' },
        { label: 'Search Memories', id: 'search' },
        { label: 'Get Memories', id: 'get' },
      ],
      placeholder: 'Select an operation',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Mem0 API key',
      password: true,
      description: 'Get your API key from mem0.ai',
    },
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter user identifier',
      description: 'User ID for associating memories',
      value: () => 'userid', // Default to the working user ID from curl example
    },
    {
      id: 'version',
      title: 'API Version',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'v2 (Default)', id: 'v2' },
        { label: 'v1', id: 'v1' }
      ],
      description: 'API version to use - default is v2',
    },
    {
      id: 'messages',
      title: 'Messages',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter messages as JSON array with role and content',
      language: 'json',
      condition: {
        field: 'operation',
        value: 'add',
      },
      description: 'Required format: [{"role": "user", "content": "Hello"}, {"role": "assistant", "content": "Hi there!"}]',
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter search query to find relevant memories',
      condition: {
        field: 'operation',
        value: 'search',
      },
      description: 'Use natural language to describe what you\'re looking for. Example: "Conversations about travel plans" or "Information about user preferences"',
    },
    {
      id: 'memoryId',
      title: 'Memory ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Specific memory ID to retrieve',
      condition: {
        field: 'operation',
        value: 'get',
      },
      description: 'ID from a previous memory operation',
    },
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      layout: 'half',
      placeholder: 'YYYY-MM-DD',
      condition: {
        field: 'operation',
        value: 'get',
      },
      description: 'Filter memories created on or after this date',
    },
    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      layout: 'half',
      placeholder: 'YYYY-MM-DD',
      condition: {
        field: 'operation',
        value: 'get',
      },
      description: 'Filter memories created on or before this date',
    },
    {
      id: 'limit',
      title: 'Result Limit',
      type: 'slider',
      layout: 'half',
      min: 1,
      max: 50,
      condition: {
        field: 'operation',
        value: ['search', 'get'],
      },
      description: 'Maximum number of results to return',
    },
  ],
  tools: {
    access: [
      'mem0_add_memories',
      'mem0_search_memories',
      'mem0_get_memories',
    ],
    config: {
      tool: (params: Record<string, any>) => {
        const operation = params.operation || 'add'
        switch (operation) {
          case 'add':
            return 'mem0_add_memories'
          case 'search':
            return 'mem0_search_memories'
          case 'get':
            return 'mem0_get_memories'
          default:
            return 'mem0_add_memories'
        }
      },
      params: (params: Record<string, any>) => {
        // Create detailed error information for any missing required fields
        const errors: string[] = [];
        
        // Validate required API key for all operations
        if (!params.apiKey) {
          errors.push("API Key is required");
        }
        
        // For search operation, validate required fields
        if (params.operation === 'search') {
          if (!params.query || params.query.trim() === '') {
            errors.push("Search Query is required");
          }
          
          if (!params.userId) {
            errors.push("User ID is required");
          }
        }
        
        // For add operation, validate required fields
        if (params.operation === 'add') {
          if (!params.messages) {
            errors.push("Messages are required for add operation");
          } else {
            try {
              const messagesArray = typeof params.messages === 'string' 
                ? JSON.parse(params.messages) 
                : params.messages;
              
              if (!Array.isArray(messagesArray) || messagesArray.length === 0) {
                errors.push("Messages must be a non-empty array");
              } else {
                for (const msg of messagesArray) {
                  if (!msg.role || !msg.content) {
                    errors.push("Each message must have 'role' and 'content' properties");
                    break;
                  }
                }
              }
            } catch (e) {
              errors.push("Messages must be valid JSON");
            }
          }
          
          if (!params.userId) {
            errors.push("User ID is required");
          }
        }
        
        // Throw error if any required fields are missing
        if (errors.length > 0) {
          console.error('Validation errors:', errors);
          throw new Error(`Mem0 Block Error: ${errors.join(', ')}`);
        }
        
        const result: Record<string, any> = {
          apiKey: params.apiKey,
        }

        // Add any identifiers that are present
        if (params.userId) result.userId = params.userId;
        
        // Add version if specified
        if (params.version) result.version = params.version;

        if (params.limit) result.limit = params.limit;

        const operation = params.operation || 'add';
        
        // Add operation-specific debugging
        console.log(`Mem0 Block: Processing ${operation} operation`, params);
        
        switch (operation) {
          case 'add':
            if (params.messages) {
              try {
                // Ensure messages are properly formatted
                const messagesArray = typeof params.messages === 'string' 
                  ? JSON.parse(params.messages) 
                  : params.messages;
                
                // Validate message structure
                if (Array.isArray(messagesArray) && messagesArray.length > 0) {
                  let validMessages = true;
                  for (const msg of messagesArray) {
                    if (!msg.role || !msg.content) {
                      validMessages = false;
                      break;
                    }
                  }
                  if (validMessages) {
                    result.messages = messagesArray;
                  } else {
                    console.error('Invalid message format - each message must have role and content');
                  }
                } else {
                  console.error('Messages must be a non-empty array');
                }
              } catch (e) {
                console.error('Error parsing messages JSON:', e);
              }
            }
            break;
          case 'search':
            if (params.query) {
              result.query = params.query;
              console.log('Search query:', params.query);
              
              // Check if we have at least one identifier for search
              let hasIdentifier = false;
              
              if (params.userId) {
                result.userId = params.userId;
                hasIdentifier = true;
                console.log('Using user_id for search:', params.userId);
              }
              
              if (!hasIdentifier) {
                console.error('CRITICAL ERROR: Search requires at least one ID (userId)');
              }
            } else {
              console.error('CRITICAL ERROR: Search requires a query parameter');
            }
            
            // Include limit if specified
            if (params.limit) {
              result.limit = Number(params.limit);
            }
            break;
          case 'get':
            if (params.memoryId) result.memoryId = params.memoryId;
            
            // Add date range filtering for v2 get memories
            if (params.startDate) {
              result.startDate = params.startDate;
              console.log('Filtering memories from date:', params.startDate);
            }
            
            if (params.endDate) {
              result.endDate = params.endDate;
              console.log('Filtering memories to date:', params.endDate);
            }
            break;
        }
        
        // Add debugging log
        console.log('Mem0 params being sent to tool:', JSON.stringify(result, null, 2));
        
        return result;
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    apiKey: { type: 'string', required: true },
    userId: { type: 'string', required: true },
    version: { type: 'string', required: false },
    messages: { type: 'json', required: false },
    query: { type: 'string', required: false },
    memoryId: { type: 'string', required: false },
    startDate: { type: 'string', required: false },
    endDate: { type: 'string', required: false },
    limit: { type: 'number', required: false },
  },
  outputs: {
    response: {
      type: {
        ids: 'any',
        memories: 'any',
        searchResults: 'any',
      },
    },
  },
} 