import { ZapierIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { ZapierResponse } from '@/tools/zapier/types'

export const ZapierBlock: BlockConfig<ZapierResponse> = {
  type: 'zapier',
  name: 'Zapier',
  description: 'Execute actions across 7,000+ apps using Zapier AI Actions',
  authMode: AuthMode.OAuth,
  longDescription:
    'Connect to Zapier AI Actions to execute any of 30,000+ actions across 7,000+ apps. Send emails, create documents, update CRMs, post messages, and more - all through natural language instructions.',
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
        { label: 'Stateless Execute', id: 'stateless_execute' },
        { label: 'List Actions', id: 'list' },
        { label: 'Search Apps', id: 'search_apps' },
        { label: 'Search App Actions', id: 'search_app_actions' },
        { label: 'Find Actions', id: 'guess' },
        { label: 'Get Action Details', id: 'get_action_details' },
        { label: 'Create Action', id: 'create' },
        { label: 'Update Action', id: 'update' },
        { label: 'Delete Action', id: 'delete' },
      ],
      value: () => 'execute',
    },
    {
      id: 'credential',
      title: 'Zapier Account',
      type: 'oauth-input',
      serviceId: 'zapier',
      requiredScopes: ['openid', 'nla:exposed_actions:execute'],
      placeholder: 'Select Zapier account',
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
        { label: 'Write (Create/Send)', id: 'actionTypes_write' },
        { label: 'Search (Find)', id: 'actionTypes_search' },
        { label: 'Read (Get)', id: 'actionTypes_read' },
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
    // Stateless Execute fields
    {
      id: 'statelessApp',
      title: 'App',
      type: 'short-input',
      placeholder: 'App identifier (e.g., "SlackAPI", "GmailV2API")',
      condition: {
        field: 'operation',
        value: 'stateless_execute',
      },
      required: true,
    },
    {
      id: 'statelessAction',
      title: 'Action',
      type: 'short-input',
      placeholder: 'Action identifier (e.g., "send_channel_message")',
      condition: {
        field: 'operation',
        value: 'stateless_execute',
      },
      required: true,
    },
    {
      id: 'statelessInstructions',
      title: 'Instructions',
      type: 'long-input',
      placeholder: 'Describe what you want to do in plain English',
      condition: {
        field: 'operation',
        value: 'stateless_execute',
      },
      required: true,
    },
    {
      id: 'statelessActionType',
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
        value: 'stateless_execute',
      },
    },
    {
      id: 'statelessParams',
      title: 'Parameters',
      type: 'code',
      placeholder: '{\n  "channel": {"mode": "locked", "value": "#general"}\n}',
      condition: {
        field: 'operation',
        value: 'stateless_execute',
      },
    },
    {
      id: 'statelessPreviewOnly',
      title: 'Preview Mode',
      type: 'dropdown',
      options: [
        { label: 'Execute', id: 'false' },
        { label: 'Preview Only', id: 'true' },
      ],
      value: () => 'false',
      condition: {
        field: 'operation',
        value: 'stateless_execute',
      },
    },
    // Search App Actions fields
    {
      id: 'searchAppActionsApp',
      title: 'App',
      type: 'short-input',
      placeholder: 'App identifier (e.g., "SlackAPI", "GmailV2API")',
      condition: {
        field: 'operation',
        value: 'search_app_actions',
      },
      required: true,
    },
    {
      id: 'searchAppActionsQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Optional: filter actions by name',
      condition: {
        field: 'operation',
        value: 'search_app_actions',
      },
    },
    {
      id: 'searchAppActionsTypes',
      title: 'Action Types',
      type: 'checkbox-list',
      options: [
        { label: 'Write (Create/Send)', id: 'searchAppActionsTypes_write' },
        { label: 'Search (Find)', id: 'searchAppActionsTypes_search' },
        { label: 'Read (Get)', id: 'searchAppActionsTypes_read' },
      ],
      condition: {
        field: 'operation',
        value: 'search_app_actions',
      },
    },
    // Get Action Details fields
    {
      id: 'detailsApp',
      title: 'App',
      type: 'short-input',
      placeholder: 'App identifier (e.g., "SlackAPI", "GmailV2API")',
      condition: {
        field: 'operation',
        value: 'get_action_details',
      },
      required: true,
    },
    {
      id: 'detailsAction',
      title: 'Action',
      type: 'short-input',
      placeholder: 'Action identifier (e.g., "send_channel_message")',
      condition: {
        field: 'operation',
        value: 'get_action_details',
      },
      required: true,
    },
    {
      id: 'detailsActionType',
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
        value: 'get_action_details',
      },
    },
    {
      id: 'includeNeeds',
      title: 'Include Inputs (Needs)',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      condition: {
        field: 'operation',
        value: 'get_action_details',
      },
    },
    {
      id: 'includeGives',
      title: 'Include Outputs (Gives)',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'false',
      condition: {
        field: 'operation',
        value: 'get_action_details',
      },
    },
    {
      id: 'includeSample',
      title: 'Include Sample',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'false',
      condition: {
        field: 'operation',
        value: 'get_action_details',
      },
    },
    // Update Action fields
    {
      id: 'updateActionId',
      title: 'Action ID',
      type: 'short-input',
      placeholder: 'The ID of the AI Action to update',
      condition: {
        field: 'operation',
        value: 'update',
      },
      required: true,
    },
    {
      id: 'updateApp',
      title: 'App',
      type: 'short-input',
      placeholder: 'App identifier (e.g., "SlackAPI")',
      condition: {
        field: 'operation',
        value: 'update',
      },
      required: true,
    },
    {
      id: 'updateAction',
      title: 'Action',
      type: 'short-input',
      placeholder: 'Action identifier (e.g., "send_channel_message")',
      condition: {
        field: 'operation',
        value: 'update',
      },
      required: true,
    },
    {
      id: 'updateActionType',
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
        value: 'update',
      },
    },
    {
      id: 'updateParams',
      title: 'Parameters',
      type: 'code',
      placeholder: '{\n  "channel": "#general"\n}',
      condition: {
        field: 'operation',
        value: 'update',
      },
    },
    // Delete Action fields
    {
      id: 'deleteActionId',
      title: 'Action ID',
      type: 'short-input',
      placeholder: 'The ID of the AI Action to delete',
      condition: {
        field: 'operation',
        value: 'delete',
      },
      required: true,
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
          case 'stateless_execute':
            return 'zapier_stateless_execute'
          case 'list':
            return 'zapier_list_actions'
          case 'search_apps':
            return 'zapier_search_apps'
          case 'search_app_actions':
            return 'zapier_search_app_actions'
          case 'guess':
            return 'zapier_guess_actions'
          case 'get_action_details':
            return 'zapier_get_action_details'
          case 'create':
            return 'zapier_create_action'
          case 'update':
            return 'zapier_update_action'
          case 'delete':
            return 'zapier_delete_action'
          default:
            throw new Error(`Invalid Zapier operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          operation,
          credential,
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
          statelessApp,
          statelessAction,
          statelessInstructions,
          statelessActionType,
          statelessParams,
          statelessPreviewOnly,
          searchAppActionsApp,
          searchAppActionsQuery,
          detailsApp,
          detailsAction,
          detailsActionType,
          includeNeeds,
          includeGives,
          includeSample,
          updateActionId,
          updateApp,
          updateAction,
          updateActionType,
          updateParams,
          deleteActionId,
        } = params

        const baseParams: Record<string, any> = { credential }

        // Helper to parse JSON params
        const parseJsonParams = (jsonParams: any) => {
          if (!jsonParams) return undefined
          try {
            return typeof jsonParams === 'string' ? JSON.parse(jsonParams) : jsonParams
          } catch {
            throw new Error('Invalid JSON in parameters field')
          }
        }

        // Helper to collect checkbox-list values
        // Use truthy check since values may be boolean true or string "true" after serialization
        const collectActionTypes = (prefix: string) => {
          const types: string[] = []
          const writeVal = params[`${prefix}_write`]
          const searchVal = params[`${prefix}_search`]
          const readVal = params[`${prefix}_read`]
          if (writeVal === true || writeVal === 'true') types.push('write')
          if (searchVal === true || searchVal === 'true') types.push('search')
          if (readVal === true || readVal === 'true') types.push('read')
          return types.length > 0 ? types : undefined
        }

        switch (operation) {
          case 'execute':
            baseParams.actionId = actionId
            baseParams.instructions = instructions
            baseParams.params = parseJsonParams(execParams)
            baseParams.previewOnly = previewOnly === 'true'
            break

          case 'stateless_execute':
            baseParams.app = statelessApp
            baseParams.action = statelessAction
            baseParams.instructions = statelessInstructions
            baseParams.actionType = statelessActionType || 'write'
            baseParams.params = parseJsonParams(statelessParams)
            baseParams.previewOnly = statelessPreviewOnly === 'true'
            break

          case 'list':
            break

          case 'search_apps':
            if (searchQuery) baseParams.query = searchQuery
            break

          case 'search_app_actions':
            baseParams.app = searchAppActionsApp
            if (searchAppActionsQuery) baseParams.query = searchAppActionsQuery
            baseParams.actionTypes = collectActionTypes('searchAppActionsTypes')
            break

          case 'guess': {
            baseParams.query = guessQuery
            // Checkbox-list values are stored under prefixed option IDs (actionTypes_write, etc.)
            baseParams.actionTypes = collectActionTypes('actionTypes')
            if (resultCount) {
              const count = Number.parseInt(resultCount, 10)
              if (!Number.isNaN(count)) baseParams.count = count
            }
            break
          }

          case 'get_action_details':
            baseParams.app = detailsApp
            baseParams.action = detailsAction
            baseParams.actionType = detailsActionType || 'write'
            baseParams.includeNeeds = includeNeeds !== 'false'
            baseParams.includeGives = includeGives === 'true'
            baseParams.includeSample = includeSample === 'true'
            break

          case 'create':
            baseParams.app = app
            baseParams.action = action
            baseParams.actionType = createActionType || 'write'
            baseParams.params = parseJsonParams(createParams)
            break

          case 'update':
            baseParams.actionId = updateActionId
            baseParams.app = updateApp
            baseParams.action = updateAction
            baseParams.actionType = updateActionType || 'write'
            baseParams.params = parseJsonParams(updateParams)
            break

          case 'delete':
            baseParams.actionId = deleteActionId
            break
        }

        return baseParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Zapier OAuth credential' },
    // Execute inputs
    actionId: { type: 'string', description: 'AI Action ID to execute' },
    instructions: { type: 'string', description: 'Plain English instructions for the action' },
    params: { type: 'json', description: 'Optional parameter constraints' },
    previewOnly: { type: 'string', description: 'Whether to preview without executing' },
    // Stateless execute inputs
    statelessApp: { type: 'string', description: 'App identifier for stateless execute' },
    statelessAction: { type: 'string', description: 'Action identifier for stateless execute' },
    statelessInstructions: { type: 'string', description: 'Instructions for stateless execute' },
    statelessActionType: { type: 'string', description: 'Action type for stateless execute' },
    statelessParams: { type: 'json', description: 'Parameters for stateless execute' },
    statelessPreviewOnly: { type: 'string', description: 'Preview mode for stateless execute' },
    // Search inputs
    searchQuery: { type: 'string', description: 'App search query' },
    // Search app actions inputs
    searchAppActionsApp: { type: 'string', description: 'App to search actions for' },
    searchAppActionsQuery: { type: 'string', description: 'Query to filter actions' },
    searchAppActionsTypes_write: { type: 'boolean', description: 'Include write actions' },
    searchAppActionsTypes_search: { type: 'boolean', description: 'Include search actions' },
    searchAppActionsTypes_read: { type: 'boolean', description: 'Include read actions' },
    // Guess inputs
    guessQuery: { type: 'string', description: 'Natural language query to find actions' },
    actionTypes_write: { type: 'boolean', description: 'Include write actions' },
    actionTypes_search: { type: 'boolean', description: 'Include search actions' },
    actionTypes_read: { type: 'boolean', description: 'Include read actions' },
    resultCount: { type: 'string', description: 'Maximum number of results' },
    // Get action details inputs
    detailsApp: { type: 'string', description: 'App identifier for action details' },
    detailsAction: { type: 'string', description: 'Action identifier for action details' },
    detailsActionType: { type: 'string', description: 'Action type for action details' },
    includeNeeds: { type: 'string', description: 'Include input requirements' },
    includeGives: { type: 'string', description: 'Include output specifications' },
    includeSample: { type: 'string', description: 'Include sample data' },
    // Create inputs
    app: { type: 'string', description: 'App identifier' },
    action: { type: 'string', description: 'Action identifier' },
    createActionType: { type: 'string', description: 'Type of action to create' },
    createParams: { type: 'json', description: 'Pre-configured parameters' },
    // Update inputs
    updateActionId: { type: 'string', description: 'AI Action ID to update' },
    updateApp: { type: 'string', description: 'App identifier for update' },
    updateAction: { type: 'string', description: 'Action identifier for update' },
    updateActionType: { type: 'string', description: 'Action type for update' },
    updateParams: { type: 'json', description: 'Parameters for update' },
    // Delete inputs
    deleteActionId: { type: 'string', description: 'AI Action ID to delete' },
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
    // Get Action Details outputs
    needs: {
      type: 'json',
      description: 'Array of input requirements for the action',
    },
    gives: {
      type: 'json',
      description: 'Array of output fields from the action',
    },
    sample: {
      type: 'json',
      description: 'Sample execution result',
    },
    customNeedsProbability: {
      type: 'number',
      description: 'Probability that action has custom/dynamic input fields',
    },
    // Delete Action outputs
    deleted: {
      type: 'boolean',
      description: 'Whether the action was successfully deleted',
    },
    message: {
      type: 'string',
      description: 'Status message for delete operation',
    },
  },
}
