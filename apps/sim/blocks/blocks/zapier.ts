import { ZapierIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { ZapierResponse } from '@/tools/zapier/types'

export const ZapierBlock: BlockConfig<ZapierResponse> = {
  type: 'zapier',
  name: 'Zapier',
  description: 'Execute actions across 7,000+ apps using Zapier AI Actions',
  longDescription:
    'Connect to Zapier AI Actions to execute any of 30,000+ actions across 7,000+ apps. Send emails, create documents, update CRMs, post messages, and more - all through natural language instructions. Requires a Zapier AI Actions API key.',
  docsLink: 'https://docs.sim.ai/tools/zapier',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: ZapierIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Execute Action', id: 'execute' },
        { label: 'List Actions', id: 'list' },
        { label: 'Search Apps', id: 'search_apps' },
        { label: 'Find Actions', id: 'guess' },
        { label: 'Create Action', id: 'create' },
      ],
      value: () => 'execute',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Zapier AI Actions API key',
      password: true,
      required: true,
    },
    // Execute Action fields
    {
      id: 'actionId',
      title: 'Action ID',
      type: 'short-input',
      placeholder: 'Enter the AI Action ID to execute',
      condition: {
        field: 'operation',
        value: 'execute',
      },
      required: true,
    },
    {
      id: 'instructions',
      title: 'Instructions',
      type: 'long-input',
      placeholder:
        'Describe what you want to do in plain English (e.g., "Send a message to #general saying hello")',
      condition: {
        field: 'operation',
        value: 'execute',
      },
      required: true,
    },
    {
      id: 'params',
      title: 'Parameters',
      type: 'code',
      placeholder: '{\n  "channel": {"mode": "locked", "value": "#general"}\n}',
      condition: {
        field: 'operation',
        value: 'execute',
      },
    },
    {
      id: 'previewOnly',
      title: 'Preview Mode',
      type: 'dropdown',
      options: [
        { label: 'Execute', id: 'false' },
        { label: 'Preview Only', id: 'true' },
      ],
      value: () => 'false',
      condition: {
        field: 'operation',
        value: 'execute',
      },
    },
    // Search Apps fields
    {
      id: 'searchQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter app name to search (e.g., "slack", "google")',
      condition: {
        field: 'operation',
        value: 'search_apps',
      },
    },
    // Guess Actions fields
    {
      id: 'guessQuery',
      title: 'What do you want to do?',
      type: 'long-input',
      placeholder:
        'Describe in plain English (e.g., "send a Slack message", "create a Google Doc")',
      condition: {
        field: 'operation',
        value: 'guess',
      },
      required: true,
    },
    {
      id: 'actionTypes',
      title: 'Action Types',
      type: 'checkbox-list',
      options: [
        { label: 'Write (Create/Send)', id: 'write' },
        { label: 'Search (Find)', id: 'search' },
        { label: 'Read (Get)', id: 'read' },
      ],
      condition: {
        field: 'operation',
        value: 'guess',
      },
    },
    {
      id: 'resultCount',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '25',
      condition: {
        field: 'operation',
        value: 'guess',
      },
    },
    // Create Action fields
    {
      id: 'app',
      title: 'App',
      type: 'short-input',
      placeholder: 'App identifier (e.g., "slack", "gmail")',
      condition: {
        field: 'operation',
        value: 'create',
      },
      required: true,
    },
    {
      id: 'action',
      title: 'Action',
      type: 'short-input',
      placeholder: 'Action identifier (e.g., "send_channel_message")',
      condition: {
        field: 'operation',
        value: 'create',
      },
      required: true,
    },
    {
      id: 'createActionType',
      title: 'Action Type',
      type: 'dropdown',
      options: [
        { label: 'Write', id: 'write' },
        { label: 'Search', id: 'search' },
        { label: 'Read', id: 'read' },
      ],
      value: () => 'write',
      condition: {
        field: 'operation',
        value: 'create',
      },
    },
    {
      id: 'createParams',
      title: 'Parameters',
      type: 'code',
      placeholder: '{\n  "channel": "#general"\n}',
      condition: {
        field: 'operation',
        value: 'create',
      },
    },
  ],
  tools: {
    access: [
      'zapier_execute_action',
      'zapier_list_actions',
      'zapier_search_apps',
      'zapier_guess_actions',
      'zapier_create_action',
      'zapier_stateless_execute',
      'zapier_search_app_actions',
      'zapier_get_action_details',
      'zapier_update_action',
      'zapier_delete_action',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'execute':
            return 'zapier_execute_action'
          case 'list':
            return 'zapier_list_actions'
          case 'search_apps':
            return 'zapier_search_apps'
          case 'guess':
            return 'zapier_guess_actions'
          case 'create':
            return 'zapier_create_action'
          default:
            throw new Error(`Invalid Zapier operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          operation,
          apiKey,
          actionId,
          instructions,
          params: execParams,
          previewOnly,
          searchQuery,
          guessQuery,
          resultCount,
          app,
          action,
          createActionType,
          createParams,
        } = params

        if (!apiKey) {
          throw new Error('Zapier API key is required')
        }

        const baseParams: Record<string, any> = {
          apiKey,
        }

        switch (operation) {
          case 'execute': {
            if (!actionId) {
              throw new Error('Action ID is required for execute operation')
            }
            if (!instructions) {
              throw new Error('Instructions are required for execute operation')
            }
            baseParams.actionId = actionId
            baseParams.instructions = instructions
            if (execParams) {
              try {
                baseParams.params =
                  typeof execParams === 'string' ? JSON.parse(execParams) : execParams
              } catch {
                throw new Error('Invalid JSON in parameters field')
              }
            }
            baseParams.previewOnly = previewOnly === 'true'
            break
          }

          case 'list':
            break

          case 'search_apps':
            if (searchQuery) {
              baseParams.query = searchQuery
            }
            break

          case 'guess': {
            if (!guessQuery) {
              throw new Error('Search query is required for find actions operation')
            }
            baseParams.query = guessQuery
            const actionTypes: string[] = []
            if (params.write === true) actionTypes.push('write')
            if (params.search === true) actionTypes.push('search')
            if (params.read === true) actionTypes.push('read')
            if (actionTypes.length > 0) {
              baseParams.actionTypes = actionTypes
            }
            if (resultCount) {
              const count = Number.parseInt(resultCount, 10)
              if (!Number.isNaN(count)) {
                baseParams.count = count
              }
            }
            break
          }

          case 'create': {
            if (!app) {
              throw new Error('App is required for create action operation')
            }
            if (!action) {
              throw new Error('Action is required for create action operation')
            }
            baseParams.app = app
            baseParams.action = action
            baseParams.actionType = createActionType || 'write'
            if (createParams) {
              try {
                baseParams.params =
                  typeof createParams === 'string' ? JSON.parse(createParams) : createParams
              } catch {
                throw new Error('Invalid JSON in parameters field')
              }
            }
            break
          }
        }

        return baseParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Zapier AI Actions API key' },
    // Execute inputs
    actionId: { type: 'string', description: 'AI Action ID to execute' },
    instructions: { type: 'string', description: 'Plain English instructions for the action' },
    params: { type: 'json', description: 'Optional parameter constraints' },
    previewOnly: { type: 'string', description: 'Whether to preview without executing' },
    // Search inputs
    searchQuery: { type: 'string', description: 'App search query' },
    // Guess inputs
    guessQuery: { type: 'string', description: 'Natural language query to find actions' },
    write: { type: 'boolean', description: 'Include write actions' },
    search: { type: 'boolean', description: 'Include search actions' },
    read: { type: 'boolean', description: 'Include read actions' },
    resultCount: { type: 'string', description: 'Maximum number of results' },
    // Create inputs
    app: { type: 'string', description: 'App identifier' },
    action: { type: 'string', description: 'Action identifier' },
    createActionType: { type: 'string', description: 'Type of action to create' },
    createParams: { type: 'json', description: 'Pre-configured parameters' },
  },
  outputs: {
    // Execute Action outputs
    executionLogId: {
      type: 'string',
      description: 'Unique identifier for the execution',
    },
    actionUsed: {
      type: 'string',
      description: 'Name of the action that was executed',
    },
    inputParams: {
      type: 'json',
      description: 'Parameters passed to the API',
    },
    resolvedParams: {
      type: 'json',
      description: 'Parameters resolved by AI for execution',
    },
    results: {
      type: 'json',
      description: 'Results from action execution',
    },
    resultFieldLabels: {
      type: 'json',
      description: 'Human-readable labels for result fields',
    },
    status: {
      type: 'string',
      description: 'Execution status (success, error, preview, etc.)',
    },
    error: {
      type: 'string',
      description: 'Error message if execution failed',
    },
    // List Actions outputs
    actions: {
      type: 'json',
      description:
        'Array of AI Actions with id, description, actionType, app, appLabel, action, actionLabel, params, accountId, authenticationId, configurationLink (list) or guessed actions (find)',
    },
    configurationLink: {
      type: 'string',
      description: 'Link to configure actions in Zapier (list operation only)',
    },
    // Search Apps outputs
    apps: {
      type: 'json',
      description:
        'Array of apps with app, name, logoUrl, authType, actionCount, writeActionCount, searchActionCount, readActionCount',
    },
    // Guess Actions outputs (in addition to 'actions' above)
    name: {
      type: 'string',
      description: 'Combined app and action name (find operation)',
    },
    image: {
      type: 'string',
      description: 'App logo URL (find operation)',
    },
    score: {
      type: 'number',
      description: 'Relevance score for guessed actions (find operation)',
    },
    // Create Action outputs
    id: {
      type: 'string',
      description: 'ID of the created AI Action',
    },
    description: {
      type: 'string',
      description: 'Description of the action',
    },
    actionType: {
      type: 'string',
      description:
        'Type of action (write, search, read, read_bulk, search_or_write, search_and_write)',
    },
    app: {
      type: 'string',
      description: 'App identifier',
    },
    appLabel: {
      type: 'string',
      description: 'Human-readable app label',
    },
    action: {
      type: 'string',
      description: 'Action identifier',
    },
    actionLabel: {
      type: 'string',
      description: 'Human-readable action label',
    },
    params: {
      type: 'json',
      description: 'Configured parameter values',
    },
    accountId: {
      type: 'number',
      description: 'Zapier account ID',
    },
    authenticationId: {
      type: 'number',
      description: 'Authentication ID used for the app',
    },
  },
}
