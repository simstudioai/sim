import type { ToolResponse } from '@/tools/types'

// Base params - all Zapier tools require OAuth access token
export interface ZapierBaseParams {
  accessToken: string
}

// Parameter constraint for execute action
export interface ZapierParamConstraint {
  mode: 'locked' | 'guess' | 'choose_from' | 'ignored'
  value?: string | number | boolean | any[] | Record<string, any>
  label?: string | any[] | Record<string, any>
}

// Action types supported by Zapier API
export type ZapierActionType =
  | 'write'
  | 'search'
  | 'read'
  | 'read_bulk'
  | 'search_or_write'
  | 'search_and_write'

// Execute Action params
export interface ZapierExecuteActionParams extends ZapierBaseParams {
  actionId: string
  instructions: string
  params?: Record<string, ZapierParamConstraint>
  previewOnly?: boolean
}

// List Actions params
export interface ZapierListActionsParams extends ZapierBaseParams {}

// Search Apps params
export interface ZapierSearchAppsParams extends ZapierBaseParams {
  query?: string
}

// Guess Actions params (find actions based on natural language)
export interface ZapierGuessActionsParams extends ZapierBaseParams {
  query: string
  actionTypes?: ZapierActionType[]
  count?: number
}

// Create AI Action params
export interface ZapierCreateAiActionParams extends ZapierBaseParams {
  app: string
  action: string
  actionType?: ZapierActionType
  params?: Record<string, string | string[]>
  accountId?: number
  authenticationId?: number
  meta?: {
    params?: Record<string, { label?: string }>
    app_label?: string
    action_label?: string
    authentication_label?: string
    app_needs_auth?: boolean
  }
}

// Stateless Execute params
export interface ZapierStatelessExecuteParams extends ZapierBaseParams {
  app: string
  action: string
  instructions: string
  actionType?: ZapierActionType
  params?: Record<string, ZapierParamConstraint>
  previewOnly?: boolean
  authenticationId?: number
  accountId?: number
  providerId?: string
  tokenBudget?: number
  skipParamGuessing?: boolean
}

// Search App Actions params
export interface ZapierSearchAppActionsParams extends ZapierBaseParams {
  app: string
  query?: string
  actionTypes?: ZapierActionType[]
}

// Get Action Details params
export interface ZapierGetActionDetailsParams extends ZapierBaseParams {
  app: string
  action: string
  actionType?: ZapierActionType
  includeNeeds?: boolean
  includeGives?: boolean
  includeSample?: boolean
  params?: Record<string, any>
  accountId?: number
  authenticationId?: number
}

// Update AI Action params
export interface ZapierUpdateAiActionParams extends ZapierBaseParams {
  actionId: string
  app: string
  action: string
  actionType?: ZapierActionType
  params?: Record<string, string | string[]>
  accountId?: number
  authenticationId?: number
  meta?: {
    params?: Record<string, { label?: string }>
    app_label?: string
    action_label?: string
    authentication_label?: string
    app_needs_auth?: boolean
  }
}

// Delete AI Action params
export interface ZapierDeleteAiActionParams extends ZapierBaseParams {
  actionId: string
}

// Execute Action response
export interface ZapierExecuteActionResponse extends ToolResponse {
  output: {
    executionLogId: string
    actionUsed: string
    inputParams: Record<string, any>
    resolvedParams: Record<string, any>
    results: any[]
    resultFieldLabels: Record<string, string>
    status: 'success' | 'error' | 'empty' | 'preview' | 'halted'
    error?: string
  }
}

// List Actions response
export interface ZapierAiAction {
  id: string
  description: string
  actionType: string
  app: string
  appLabel: string
  action: string
  actionLabel: string
  params: Record<string, any>
  accountId: number | null
  authenticationId: number | null
  needs: any[] | null
}

export interface ZapierListActionsResponse extends ToolResponse {
  output: {
    actions: ZapierAiAction[]
    configurationLink: string
  }
}

// Search Apps response
export interface ZapierAppActions {
  write?: number
  search?: number
  read?: number
  read_bulk?: number
  search_or_write?: number
  search_and_write?: number
}

export interface ZapierApp {
  app: string
  name: string
  logoUrl: string
  authType: string | null
  actions: ZapierAppActions
  actionCount: number
  writeActionCount: number
  searchActionCount: number
  readActionCount: number
}

export interface ZapierSearchAppsResponse extends ToolResponse {
  output: {
    apps: ZapierApp[]
  }
}

// Guess Actions response - matches exact API response structure
export interface ZapierGuessedAction {
  app: string
  action: string
  actionType: string
  name: string // Combined app and action name from API
  description: string
  image: string
  score: number
}

export interface ZapierGuessActionsResponse extends ToolResponse {
  output: {
    actions: ZapierGuessedAction[]
  }
}

// Create AI Action response - matches exact API response structure
export interface ZapierCreateAiActionResponse extends ToolResponse {
  output: {
    id: string
    description: string
    actionType: string
    app: string
    appLabel: string
    action: string
    actionLabel: string
    params: Record<string, any>
    accountId: number | null
    authenticationId: number | null
  }
}

// Stateless Execute response - same as Execute Action response
export interface ZapierStatelessExecuteResponse extends ToolResponse {
  output: {
    executionLogId: string
    actionUsed: string
    inputParams: Record<string, any>
    resolvedParams: Record<string, any>
    results: any[]
    resultFieldLabels: Record<string, string>
    status: 'success' | 'error' | 'empty' | 'preview' | 'halted'
    error?: string
  }
}

// Search App Actions response
export interface ZapierAppAction {
  app: string
  action: string
  actionType: string
  displayName: string
  description: string
  relevancyScore: number
  appNeedsAuth: boolean
  appInfo: {
    app: string
    name: string
    logoUrl: string
    authType: string
  } | null
}

export interface ZapierSearchAppActionsResponse extends ToolResponse {
  output: {
    actions: ZapierAppAction[]
  }
}

// Get Action Details response
export interface ZapierActionNeed {
  key: string
  type: string
  label: string
  required: boolean
  helpText: string
  defaultValue: any
  choices: any[] | null
  dependsOn: string[] | null
  customField: boolean
}

export interface ZapierActionGive {
  key: string
  label: string
  type: string
  score: number | null
  subscore: number | null
  important: boolean
  sample: any
}

export interface ZapierGetActionDetailsResponse extends ToolResponse {
  output: {
    action: {
      type: string
      key: string
      name: string
      noun: string
      description: string
    } | null
    needs: ZapierActionNeed[]
    gives: ZapierActionGive[]
    sample: any
    customNeedsProbability: number
  }
}

// Update AI Action response - same as Create AI Action response
export interface ZapierUpdateAiActionResponse extends ToolResponse {
  output: {
    id: string
    description: string
    actionType: string
    app: string
    appLabel: string
    action: string
    actionLabel: string
    params: Record<string, any>
    accountId: number | null
    authenticationId: number | null
  }
}

// Delete AI Action response
export interface ZapierDeleteAiActionResponse extends ToolResponse {
  output: {
    deleted: boolean
    message: string
  }
}

// Union type for all Zapier responses
export type ZapierResponse =
  | ZapierExecuteActionResponse
  | ZapierListActionsResponse
  | ZapierSearchAppsResponse
  | ZapierGuessActionsResponse
  | ZapierCreateAiActionResponse
  | ZapierStatelessExecuteResponse
  | ZapierSearchAppActionsResponse
  | ZapierGetActionDetailsResponse
  | ZapierUpdateAiActionResponse
  | ZapierDeleteAiActionResponse
