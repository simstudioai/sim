/**
 * Server-side tool definitions
 * These tools execute on the server and their results are displayed in the UI
 */

import type { ToolMetadata } from '@/lib/copilot/tools/types'

// Tool IDs for server tools
export const SERVER_TOOL_IDS = {
  SEARCH_DOCUMENTATION: 'search_documentation',
  GET_USER_WORKFLOW: 'get_user_workflow',
  BUILD_WORKFLOW: 'build_workflow',
  EDIT_WORKFLOW: 'edit_workflow',
  GET_BLOCKS_AND_TOOLS: 'get_blocks_and_tools',
  GET_BLOCKS_METADATA: 'get_blocks_metadata',
  GET_YAML_STRUCTURE: 'get_yaml_structure',
  GET_EDIT_WORKFLOW_EXAMPLES: 'get_edit_workflow_examples',
  GET_BUILD_WORKFLOW_EXAMPLES: 'get_build_workflow_examples',
  GET_ENVIRONMENT_VARIABLES: 'get_environment_variables',
  SET_ENVIRONMENT_VARIABLES: 'set_environment_variables',
  GET_WORKFLOW_CONSOLE: 'get_workflow_console',
  SEARCH_ONLINE: 'search_online',
  PLAN: 'plan',
  REASON: 'reason',
  GET_BLOCK_BEST_PRACTICES: 'get_block_best_practices',
  LIST_GDRIVE_FILES: 'list_gdrive_files',
  GET_OAUTH_CREDENTIALS: 'get_oauth_credentials',
  READ_GDRIVE_FILE: 'read_gdrive_file',
  MAKE_API_REQUEST: 'make_api_request',
} as const

export type ServerToolId = (typeof SERVER_TOOL_IDS)[keyof typeof SERVER_TOOL_IDS]

/**
 * Server tool metadata definitions
 * These define how server tools are displayed in different states
 */
export const SERVER_TOOL_METADATA: Record<ServerToolId, ToolMetadata> = {
  [SERVER_TOOL_IDS.SEARCH_DOCUMENTATION]: {
    id: SERVER_TOOL_IDS.SEARCH_DOCUMENTATION,
    displayConfig: {
      states: {
        executing: { displayName: 'Searching documentation', icon: 'spinner' },
        success: { displayName: 'Searched documentation', icon: 'file' },
        rejected: { displayName: 'Skipped documentation search', icon: 'skip' },
        errored: { displayName: 'Failed to search documentation', icon: 'error' },
        aborted: { displayName: 'Documentation search aborted', icon: 'x' },
      },
    },
    schema: {
      name: SERVER_TOOL_IDS.SEARCH_DOCUMENTATION,
      description: 'Search through documentation',
    },
    requiresInterrupt: false,
  },

  [SERVER_TOOL_IDS.GET_USER_WORKFLOW]: {
    id: SERVER_TOOL_IDS.GET_USER_WORKFLOW,
    displayConfig: {
      states: {
        executing: { displayName: 'Analyzing your workflow', icon: 'spinner' },
        success: { displayName: 'Analyzed your workflow', icon: 'workflow' },
        rejected: { displayName: 'Skipped analyzing your workflow', icon: 'skip' },
        errored: { displayName: 'Failed to analyze your workflow', icon: 'error' },
        aborted: { displayName: 'Workflow analysis aborted', icon: 'x' },
      },
    },
    schema: {
      name: SERVER_TOOL_IDS.GET_USER_WORKFLOW,
      description: 'Get current workflow details',
    },
    requiresInterrupt: false,
  },

  [SERVER_TOOL_IDS.BUILD_WORKFLOW]: {
    id: SERVER_TOOL_IDS.BUILD_WORKFLOW,
    displayConfig: {
      states: {
        ready_for_review: { displayName: 'Workflow ready for review', icon: 'grid2x2' },
        executing: { displayName: 'Building your workflow', icon: 'spinner' },
        success: { displayName: 'Built your workflow', icon: 'grid2x2' },
        rejected: { displayName: 'Workflow changes not applied', icon: 'grid2x2X' },
        errored: { displayName: 'Failed to build your workflow', icon: 'error' },
        aborted: { displayName: 'Workflow build aborted', icon: 'x' },
        accepted: { displayName: 'Built your workflow', icon: 'grid2x2Check' },
      },
    },
    schema: {
      name: SERVER_TOOL_IDS.BUILD_WORKFLOW,
      description: 'Build a new workflow',
    },
    requiresInterrupt: false,
  },

  [SERVER_TOOL_IDS.EDIT_WORKFLOW]: {
    id: SERVER_TOOL_IDS.EDIT_WORKFLOW,
    displayConfig: {
      states: {
        ready_for_review: { displayName: 'Workflow changes ready for review', icon: 'grid2x2' },
        executing: { displayName: 'Editing your workflow', icon: 'spinner' },
        success: { displayName: 'Edited your workflow', icon: 'grid2x2' },
        rejected: { displayName: 'Workflow changes not applied', icon: 'grid2x2X' },
        errored: { displayName: 'Failed to edit your workflow', icon: 'error' },
        aborted: { displayName: 'Workflow edit aborted', icon: 'x' },
        accepted: { displayName: 'Edited your workflow', icon: 'grid2x2Check' },
      },
    },
    schema: {
      name: SERVER_TOOL_IDS.EDIT_WORKFLOW,
      description: 'Edit the current workflow',
    },
    requiresInterrupt: false,
  },

  [SERVER_TOOL_IDS.GET_BLOCKS_AND_TOOLS]: {
    id: SERVER_TOOL_IDS.GET_BLOCKS_AND_TOOLS,
    displayConfig: {
      states: {
        executing: { displayName: 'Exploring available options', icon: 'spinner' },
        success: { displayName: 'Explored available options', icon: 'blocks' },
        rejected: { displayName: 'Skipped exploring options', icon: 'skip' },
        errored: { displayName: 'Failed to explore options', icon: 'error' },
        aborted: { displayName: 'Options exploration aborted', icon: 'x' },
      },
    },
    schema: {
      name: SERVER_TOOL_IDS.GET_BLOCKS_AND_TOOLS,
      description: 'Get available blocks and tools',
    },
    requiresInterrupt: false,
  },

  [SERVER_TOOL_IDS.GET_BLOCKS_METADATA]: {
    id: SERVER_TOOL_IDS.GET_BLOCKS_METADATA,
    displayConfig: {
      states: {
        executing: { displayName: 'Evaluating workflow options', icon: 'spinner' },
        success: { displayName: 'Evaluated workflow options', icon: 'betweenHorizontalEnd' },
        rejected: { displayName: 'Skipped evaluating workflow options', icon: 'skip' },
        errored: { displayName: 'Failed to evaluate workflow options', icon: 'error' },
        aborted: { displayName: 'Options evaluation aborted', icon: 'x' },
      },
    },
    schema: {
      name: SERVER_TOOL_IDS.GET_BLOCKS_METADATA,
      description: 'Get metadata for blocks',
    },
    requiresInterrupt: false,
  },

  [SERVER_TOOL_IDS.GET_YAML_STRUCTURE]: {
    id: SERVER_TOOL_IDS.GET_YAML_STRUCTURE,
    displayConfig: {
      states: {
        executing: { displayName: 'Analyzing workflow structure', icon: 'spinner' },
        success: { displayName: 'Analyzed workflow structure', icon: 'tree' },
        rejected: { displayName: 'Skipped workflow structure analysis', icon: 'skip' },
        errored: { displayName: 'Failed to analyze workflow structure', icon: 'error' },
        aborted: { displayName: 'Workflow structure analysis aborted', icon: 'x' },
      },
    },
    schema: {
      name: SERVER_TOOL_IDS.GET_YAML_STRUCTURE,
      description: 'Get workflow YAML structure',
    },
    requiresInterrupt: false,
  },

  [SERVER_TOOL_IDS.GET_EDIT_WORKFLOW_EXAMPLES]: {
    id: SERVER_TOOL_IDS.GET_EDIT_WORKFLOW_EXAMPLES,
    displayConfig: {
      states: {
        executing: { displayName: 'Optimizing edit approach', icon: 'spinner' },
        success: { displayName: 'Optimized edit approach', icon: 'gitbranch' },
        rejected: { displayName: 'Skipped optimizing edit approach', icon: 'skip' },
        errored: { displayName: 'Failed to optimize edit approach', icon: 'error' },
        aborted: { displayName: 'Edit approach optimization aborted', icon: 'x' },
      },
    },
    schema: {
      name: SERVER_TOOL_IDS.GET_EDIT_WORKFLOW_EXAMPLES,
      description: 'Get workflow examples',
    },
    requiresInterrupt: false,
  },

  [SERVER_TOOL_IDS.GET_BUILD_WORKFLOW_EXAMPLES]: {
    id: SERVER_TOOL_IDS.GET_BUILD_WORKFLOW_EXAMPLES,
    displayConfig: {
      states: {
        executing: { displayName: 'Discovering workflow patterns', icon: 'spinner' },
        success: { displayName: 'Discovered workflow patterns', icon: 'gitbranch' },
        rejected: { displayName: 'Skipped discovering patterns', icon: 'skip' },
        errored: { displayName: 'Failed to discover patterns', icon: 'error' },
        aborted: { displayName: 'Discovering patterns aborted', icon: 'x' },
      },
    },
    schema: {
      name: SERVER_TOOL_IDS.GET_BUILD_WORKFLOW_EXAMPLES,
      description: 'Get workflow examples',
    },
    requiresInterrupt: false,
  },

  [SERVER_TOOL_IDS.GET_ENVIRONMENT_VARIABLES]: {
    id: SERVER_TOOL_IDS.GET_ENVIRONMENT_VARIABLES,
    displayConfig: {
      states: {
        executing: { displayName: 'Viewing environment variables', icon: 'spinner' },
        success: { displayName: 'Found environment variables', icon: 'wrench' },
        rejected: { displayName: 'Skipped viewing environment variables', icon: 'skip' },
        errored: { displayName: 'Failed to get environment variables', icon: 'error' },
        aborted: { displayName: 'Environment variables viewing aborted', icon: 'x' },
      },
    },
    schema: {
      name: SERVER_TOOL_IDS.GET_ENVIRONMENT_VARIABLES,
      description: 'Get environment variables',
    },
    requiresInterrupt: false,
  },

  [SERVER_TOOL_IDS.SET_ENVIRONMENT_VARIABLES]: {
    id: SERVER_TOOL_IDS.SET_ENVIRONMENT_VARIABLES,
    displayConfig: {
      states: {
        pending: { displayName: 'Set environment variables', icon: 'edit' },
        executing: { displayName: 'Setting environment variables', icon: 'spinner' },
        success: { displayName: 'Set environment variables', icon: 'wrench' },
        rejected: { displayName: 'Skipped setting environment variables', icon: 'skip' },
        errored: { displayName: 'Failed to set environment variables', icon: 'error' },
        aborted: { displayName: 'Environment variables setting aborted', icon: 'x' },
      },
      getDynamicDisplayName: (state, params) => {
        try {
          const vars =
            params?.variables && typeof params.variables === 'object' ? params.variables : null
          if (!vars) return null
          const count = Object.keys(vars).length
          if (count === 0) return null
          const base = state === 'executing' ? 'Setting' : state === 'success' ? 'Set' : 'Set'
          return `${base} ${count} environment ${count === 1 ? 'variable' : 'variables'}`
        } catch {
          return null
        }
      },
    },
    schema: {
      name: SERVER_TOOL_IDS.SET_ENVIRONMENT_VARIABLES,
      description: 'Set environment variables for the workflow',
      parameters: {
        type: 'object',
        properties: {
          variables: {
            type: 'object',
            description: 'Key-value pairs of environment variables to set',
            additionalProperties: {
              type: 'string',
            },
          },
        },
        required: ['variables'],
      },
    },
    requiresInterrupt: true,
  },

  [SERVER_TOOL_IDS.GET_WORKFLOW_CONSOLE]: {
    id: SERVER_TOOL_IDS.GET_WORKFLOW_CONSOLE,
    displayConfig: {
      states: {
        executing: { displayName: 'Reading workflow console', icon: 'spinner' },
        success: { displayName: 'Read workflow console', icon: 'squareTerminal' },
        rejected: { displayName: 'Skipped reading workflow console', icon: 'skip' },
        errored: { displayName: 'Failed to read workflow console', icon: 'error' },
        aborted: { displayName: 'Workflow console reading aborted', icon: 'x' },
      },
    },
    schema: {
      name: SERVER_TOOL_IDS.GET_WORKFLOW_CONSOLE,
      description: 'Get workflow console output',
    },
    requiresInterrupt: false,
  },

  [SERVER_TOOL_IDS.SEARCH_ONLINE]: {
    id: SERVER_TOOL_IDS.SEARCH_ONLINE,
    displayConfig: {
      states: {
        executing: { displayName: 'Searching online', icon: 'spinner' },
        success: { displayName: 'Searched online', icon: 'globe' },
        rejected: { displayName: 'Skipped online search', icon: 'skip' },
        errored: { displayName: 'Failed to search online', icon: 'error' },
        aborted: { displayName: 'Online search aborted', icon: 'x' },
      },
    },
    schema: {
      name: SERVER_TOOL_IDS.SEARCH_ONLINE,
      description: 'Search online for information',
    },
    requiresInterrupt: false,
  },

  [SERVER_TOOL_IDS.PLAN]: {
    id: SERVER_TOOL_IDS.PLAN,
    displayConfig: {
      states: {
        executing: { displayName: 'Crafting an approach', icon: 'spinner' },
        success: { displayName: 'Crafted a plan', icon: 'listTodo' },
        rejected: { displayName: 'Skipped crafting a plan', icon: 'skip' },
        errored: { displayName: 'Failed to craft a plan', icon: 'error' },
        aborted: { displayName: 'Crafting a plan aborted', icon: 'x' },
      },
    },
    schema: {
      name: SERVER_TOOL_IDS.PLAN,
      description: 'Plan the approach to solve a problem',
    },
    requiresInterrupt: false,
  },

  [SERVER_TOOL_IDS.REASON]: {
    id: SERVER_TOOL_IDS.REASON,
    displayConfig: {
      states: {
        executing: { displayName: 'Designing an approach', icon: 'spinner' },
        success: { displayName: 'Designed an approach', icon: 'brain' },
        rejected: { displayName: 'Skipped reasoning', icon: 'skip' },
        errored: { displayName: 'Failed to design an approach', icon: 'error' },
        aborted: { displayName: 'Reasoning aborted', icon: 'x' },
      },
    },
    schema: {
      name: SERVER_TOOL_IDS.REASON,
      description: 'Reason through a complex problem',
    },
    requiresInterrupt: false,
  },

  [SERVER_TOOL_IDS.GET_BLOCK_BEST_PRACTICES]: {
    id: SERVER_TOOL_IDS.GET_BLOCK_BEST_PRACTICES,
    displayConfig: {
      states: {
        executing: { displayName: 'Reviewing recommendations', icon: 'spinner' },
        success: { displayName: 'Reviewed recommendations', icon: 'network' },
        rejected: { displayName: 'Skipped recommendations review', icon: 'skip' },
        errored: { displayName: 'Failed to review recommendations', icon: 'error' },
        aborted: { displayName: 'Recommendations review aborted', icon: 'x' },
      },
    },
    schema: {
      name: SERVER_TOOL_IDS.GET_BLOCK_BEST_PRACTICES,
      description: 'Get best practices and usage guidelines for workflow blocks and tools',
      parameters: {
        type: 'object',
        properties: {
          block_types: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional list of specific block types to get best practices for (e.g., "llm", "function", "loop")',
          },
          category: {
            type: 'string',
            description: 'Optional category filter (e.g., "performance", "security", "debugging")',
          },
        },
        required: [],
      },
    },
    requiresInterrupt: false,
  },

  [SERVER_TOOL_IDS.LIST_GDRIVE_FILES]: {
    id: SERVER_TOOL_IDS.LIST_GDRIVE_FILES,
    displayConfig: {
      states: {
        executing: { displayName: 'Listing Google Drive files', icon: 'spinner' },
        success: { displayName: 'Listed Google Drive files', icon: 'file' },
        rejected: { displayName: 'Skipped listing Google Drive files', icon: 'skip' },
        errored: { displayName: 'Failed to list Google Drive files', icon: 'error' },
        aborted: { displayName: 'Listing Google Drive files aborted', icon: 'x' },
      },
    },
    schema: {
      name: SERVER_TOOL_IDS.LIST_GDRIVE_FILES,
      description: "List files from the user's Google Drive",
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'The user ID' },
          search_query: { type: 'string', description: 'Optional search query' },
          num_results: { type: 'number', description: 'Optional number of results to return' },
        },
        required: ['userId'],
      },
    },
    requiresInterrupt: false,
  },

  [SERVER_TOOL_IDS.GET_OAUTH_CREDENTIALS]: {
    id: SERVER_TOOL_IDS.GET_OAUTH_CREDENTIALS,
    displayConfig: {
      states: {
        executing: { displayName: 'Retrieving OAuth credentials', icon: 'spinner' },
        success: { displayName: 'Retrieved OAuth credentials', icon: 'key' },
        rejected: { displayName: 'Skipped retrieving OAuth credentials', icon: 'skip' },
        errored: { displayName: 'Failed to retrieve OAuth credentials', icon: 'error' },
        aborted: { displayName: 'Retrieving OAuth credentials aborted', icon: 'x' },
      },
    },
    schema: {
      name: SERVER_TOOL_IDS.GET_OAUTH_CREDENTIALS,
      description: 'Get the list of OAuth credentials for a user',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'The user ID' },
        },
        required: ['userId'],
      },
    },
    requiresInterrupt: false,
  },

  [SERVER_TOOL_IDS.READ_GDRIVE_FILE]: {
    id: SERVER_TOOL_IDS.READ_GDRIVE_FILE,
    displayConfig: {
      states: {
        executing: { displayName: 'Reading Google Drive file', icon: 'spinner' },
        success: { displayName: 'Read Google Drive file', icon: 'file' },
        rejected: { displayName: 'Skipped reading Google Drive file', icon: 'skip' },
        errored: { displayName: 'Failed to read Google Drive file', icon: 'error' },
        aborted: { displayName: 'Reading Google Drive file aborted', icon: 'x' },
      },
    },
    schema: {
      name: SERVER_TOOL_IDS.READ_GDRIVE_FILE,
      description: 'Read a file from Google Drive (Docs or Sheets)',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'The user ID' },
          fileId: { type: 'string', description: 'The Google Drive file ID' },
          type: { type: 'string', enum: ['doc', 'sheet'], description: 'The file type' },
          range: { type: 'string', description: 'Optional range for Sheets (e.g., Sheet1!A1:B10)' },
        },
        required: ['userId', 'fileId', 'type'],
      },
    },
    requiresInterrupt: false,
  },

  [SERVER_TOOL_IDS.MAKE_API_REQUEST]: {
    id: SERVER_TOOL_IDS.MAKE_API_REQUEST,
    displayConfig: {
      states: {
        pending: { displayName: 'Execute API request?', icon: 'api' },
        executing: { displayName: 'Executing API request', icon: 'spinner' },
        success: { displayName: 'Executed API request', icon: 'api' },
        rejected: { displayName: 'Skipped API request', icon: 'skip' },
        errored: { displayName: 'Failed to execute API request', icon: 'error' },
        aborted: { displayName: 'API request aborted', icon: 'x' },
      },
    },
    schema: {
      name: SERVER_TOOL_IDS.MAKE_API_REQUEST,
      description: 'Make an HTTP API request using provided parameters',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Request URL' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT'], description: 'HTTP method' },
          queryParams: {
            type: 'object',
            description: 'Optional query parameters as key-value pairs',
            additionalProperties: { type: ['string', 'number', 'boolean'] },
          },
          headers: {
            type: 'object',
            description: 'Optional headers as key-value pairs',
            additionalProperties: { type: 'string' },
          },
          body: {
            type: ['object', 'string'],
            description: 'Optional JSON body (object or string)',
          },
        },
        required: ['url', 'method'],
      },
    },
    requiresInterrupt: true,
  },
}
