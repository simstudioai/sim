/**
 * Server-side tool definitions
 * These tools execute on the server and their results are displayed in the UI
 */

import type { ToolMetadata } from '../types'

// Tool IDs for server tools
export const SERVER_TOOL_IDS = {
  SEARCH_DOCUMENTATION: 'search_documentation',
  GET_USER_WORKFLOW: 'get_user_workflow',
  BUILD_WORKFLOW: 'build_workflow',
  EDIT_WORKFLOW: 'edit_workflow',
  GET_BLOCKS_AND_TOOLS: 'get_blocks_and_tools',
  GET_BLOCKS_METADATA: 'get_blocks_metadata',
  GET_YAML_STRUCTURE: 'get_yaml_structure',
  GET_WORKFLOW_EXAMPLES: 'get_workflow_examples',
  GET_ENVIRONMENT_VARIABLES: 'get_environment_variables',
  SET_ENVIRONMENT_VARIABLES: 'set_environment_variables',
  GET_WORKFLOW_CONSOLE: 'get_workflow_console',
  SEARCH_ONLINE: 'search_online',
} as const

export type ServerToolId = typeof SERVER_TOOL_IDS[keyof typeof SERVER_TOOL_IDS]

/**
 * Server tool metadata definitions
 * These define how server tools are displayed in different states
 */
export const SERVER_TOOL_METADATA: Record<ServerToolId, ToolMetadata> = {
  [SERVER_TOOL_IDS.SEARCH_DOCUMENTATION]: {
    id: SERVER_TOOL_IDS.SEARCH_DOCUMENTATION,
    displayConfig: {
      states: {
        executing: { displayName: 'Searching documentation', icon: 'loader' },
        success: { displayName: 'Searched documentation', icon: 'check' },
        rejected: { displayName: 'Skipped documentation search', icon: 'skip' },
        errored: { displayName: 'Failed to search documentation', icon: 'error' },
      }
    },
    schema: {
      name: SERVER_TOOL_IDS.SEARCH_DOCUMENTATION,
      description: 'Search through documentation'
    },
    requiresInterrupt: false
  },

  [SERVER_TOOL_IDS.GET_USER_WORKFLOW]: {
    id: SERVER_TOOL_IDS.GET_USER_WORKFLOW,
    displayConfig: {
      states: {
        executing: { displayName: 'Analyzing workflow', icon: 'loader' },
        success: { displayName: 'Analyzed workflow', icon: 'check' },
        rejected: { displayName: 'Skipped workflow analysis', icon: 'skip' },
        errored: { displayName: 'Failed to analyze workflow', icon: 'error' },
      }
    },
    schema: {
      name: SERVER_TOOL_IDS.GET_USER_WORKFLOW,
      description: 'Get current workflow details'
    },
    requiresInterrupt: false
  },

  [SERVER_TOOL_IDS.BUILD_WORKFLOW]: {
    id: SERVER_TOOL_IDS.BUILD_WORKFLOW,
    displayConfig: {
      states: {
        ready_for_review: { displayName: 'Workflow ready for review', icon: 'wrench' },
        executing: { displayName: 'Building workflow', icon: 'loader' },
        success: { displayName: 'Built workflow', icon: 'checkCircle' },
        rejected: { displayName: 'Skipped workflow build', icon: 'skip' },
        errored: { displayName: 'Failed to build workflow', icon: 'error' },
      }
    },
    schema: {
      name: SERVER_TOOL_IDS.BUILD_WORKFLOW,
      description: 'Build a new workflow'
    },
    requiresInterrupt: false
  },

  [SERVER_TOOL_IDS.EDIT_WORKFLOW]: {
    id: SERVER_TOOL_IDS.EDIT_WORKFLOW,
    displayConfig: {
      states: {
        ready_for_review: { displayName: 'Workflow changes ready for review', icon: 'code' },
        executing: { displayName: 'Editing workflow', icon: 'loader' },
        success: { displayName: 'Edited workflow', icon: 'checkCircle' },
        rejected: { displayName: 'Skipped workflow edit', icon: 'skip' },
        errored: { displayName: 'Failed to edit workflow', icon: 'error' },
      }
    },
    schema: {
      name: SERVER_TOOL_IDS.EDIT_WORKFLOW,
      description: 'Edit the current workflow'
    },
    requiresInterrupt: false
  },

  [SERVER_TOOL_IDS.GET_BLOCKS_AND_TOOLS]: {
    id: SERVER_TOOL_IDS.GET_BLOCKS_AND_TOOLS,
    displayConfig: {
      states: {
        executing: { displayName: 'Getting block information', icon: 'loader' },
        success: { displayName: 'Retrieved block information', icon: 'check' },
        rejected: { displayName: 'Skipped getting block information', icon: 'skip' },
        errored: { displayName: 'Failed to get block information', icon: 'error' },
      }
    },
    schema: {
      name: SERVER_TOOL_IDS.GET_BLOCKS_AND_TOOLS,
      description: 'Get available blocks and tools'
    },
    requiresInterrupt: false
  },

  [SERVER_TOOL_IDS.GET_BLOCKS_METADATA]: {
    id: SERVER_TOOL_IDS.GET_BLOCKS_METADATA,
    displayConfig: {
      states: {
        executing: { displayName: 'Getting block metadata', icon: 'loader' },
        success: { displayName: 'Retrieved block metadata', icon: 'check' },
        rejected: { displayName: 'Skipped getting block metadata', icon: 'skip' },
        errored: { displayName: 'Failed to get block metadata', icon: 'error' },
      }
    },
    schema: {
      name: SERVER_TOOL_IDS.GET_BLOCKS_METADATA,
      description: 'Get metadata for blocks'
    },
    requiresInterrupt: false
  },

  [SERVER_TOOL_IDS.GET_YAML_STRUCTURE]: {
    id: SERVER_TOOL_IDS.GET_YAML_STRUCTURE,
    displayConfig: {
      states: {
        executing: { displayName: 'Analyzing workflow structure', icon: 'loader' },
        success: { displayName: 'Analyzed workflow structure', icon: 'check' },
        rejected: { displayName: 'Skipped workflow structure analysis', icon: 'skip' },
        errored: { displayName: 'Failed to analyze workflow structure', icon: 'error' },
      }
    },
    schema: {
      name: SERVER_TOOL_IDS.GET_YAML_STRUCTURE,
      description: 'Get workflow YAML structure'
    },
    requiresInterrupt: false
  },

  [SERVER_TOOL_IDS.GET_WORKFLOW_EXAMPLES]: {
    id: SERVER_TOOL_IDS.GET_WORKFLOW_EXAMPLES,
    displayConfig: {
      states: {
        executing: { displayName: 'Viewing workflow examples', icon: 'loader' },
        success: { displayName: 'Viewed workflow examples', icon: 'check' },
        rejected: { displayName: 'Skipped workflow examples', icon: 'skip' },
        errored: { displayName: 'Failed to view workflow examples', icon: 'error' },
      }
    },
    schema: {
      name: SERVER_TOOL_IDS.GET_WORKFLOW_EXAMPLES,
      description: 'Get workflow examples'
    },
    requiresInterrupt: false
  },

  [SERVER_TOOL_IDS.GET_ENVIRONMENT_VARIABLES]: {
    id: SERVER_TOOL_IDS.GET_ENVIRONMENT_VARIABLES,
    displayConfig: {
      states: {
        executing: { displayName: 'Viewing environment variables', icon: 'loader' },
        success: { displayName: 'Found environment variables', icon: 'check' },
        rejected: { displayName: 'Skipped viewing environment variables', icon: 'skip' },
        errored: { displayName: 'Failed to get environment variables', icon: 'error' },
      }
    },
    schema: {
      name: SERVER_TOOL_IDS.GET_ENVIRONMENT_VARIABLES,
      description: 'Get environment variables'
    },
    requiresInterrupt: false
  },

  [SERVER_TOOL_IDS.SET_ENVIRONMENT_VARIABLES]: {
    id: SERVER_TOOL_IDS.SET_ENVIRONMENT_VARIABLES,
    displayConfig: {
      states: {
        pending: { displayName: 'Set environment variables', icon: 'edit' },
        executing: { displayName: 'Setting environment variables', icon: 'loader' },
        accepted: { displayName: 'Setting environment variables', icon: 'edit' },
        success: { displayName: 'Set environment variables', icon: 'check' },
        rejected: { displayName: 'Skipped setting environment variables', icon: 'skip' },
        errored: { displayName: 'Failed to set environment variables', icon: 'error' },
        background: { displayName: 'Setting environment variables in background', icon: 'background' },
      }
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
              type: 'string'
            }
          }
        },
        required: ['variables']
      }
    },
    requiresInterrupt: true,
  },

  [SERVER_TOOL_IDS.GET_WORKFLOW_CONSOLE]: {
    id: SERVER_TOOL_IDS.GET_WORKFLOW_CONSOLE,
    displayConfig: {
      states: {
        executing: { displayName: 'Reading workflow console', icon: 'loader' },
        success: { displayName: 'Read workflow console', icon: 'check' },
        rejected: { displayName: 'Skipped reading workflow console', icon: 'skip' },
        errored: { displayName: 'Failed to read workflow console', icon: 'error' },
      }
    },
    schema: {
      name: SERVER_TOOL_IDS.GET_WORKFLOW_CONSOLE,
      description: 'Get workflow console output'
    },
    requiresInterrupt: false
  },

  [SERVER_TOOL_IDS.SEARCH_ONLINE]: {
    id: SERVER_TOOL_IDS.SEARCH_ONLINE,
    displayConfig: {
      states: {
        executing: { displayName: 'Searching online', icon: 'loader' },
        success: { displayName: 'Searched online', icon: 'check' },
        rejected: { displayName: 'Skipped online search', icon: 'skip' },
        errored: { displayName: 'Failed to search online', icon: 'error' },
      }
    },
    schema: {
      name: SERVER_TOOL_IDS.SEARCH_ONLINE,
      description: 'Search online for information'
    },
    requiresInterrupt: false
  },
} 