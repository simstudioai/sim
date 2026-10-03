import type { OutputProperty, ToolResponse } from '@/tools/types'

/** A single entry of the `messages` array Splunk attaches to REST responses. */
export interface SplunkMessage {
  type: string | null
  text: string | null
}

/**
 * Connection and credential fields shared by every Splunk tool. `baseUrl` points at
 * the splunkd management port (default 8089). Supply either an authentication token
 * (bearer) or a username/password pair for basic authentication.
 */
export interface SplunkBaseParams {
  baseUrl: string
  authToken?: string
  username?: string
  password?: string
  /** Namespace owner for `/servicesNS` requests (defaults to the token's user). */
  owner?: string
  /** Namespace app context for `/servicesNS` requests (e.g. `search`). */
  app?: string
}

export interface SplunkRunSearchParams extends SplunkBaseParams {
  search: string
  earliestTime?: string
  latestTime?: string
  adhocSearchLevel?: string
  autoCancel?: number
  maxCount?: number
}

/**
 * Documented envelope for search results: `init_offset`, `messages`, `preview`, and
 * `results`. Row objects are the search's own fields, so their shape is dynamic.
 */
export interface SplunkSearchResultsResponse extends ToolResponse {
  output: {
    results: Record<string, unknown>[]
    resultCount: number
    preview: boolean | null
    initOffset: number | null
    messages: SplunkMessage[]
  }
}

export interface SplunkCreateSearchJobParams extends SplunkBaseParams {
  search: string
  earliestTime?: string
  latestTime?: string
  execMode?: string
  adhocSearchLevel?: string
  searchId?: string
  indexEarliest?: string
  indexLatest?: string
  enableLookups?: boolean
  allowPartialResults?: boolean
  autoCancel?: number
  maxCount?: number
}

export interface SplunkCreateSearchJobResponse extends ToolResponse {
  output: {
    sid: string
  }
}

export interface SplunkGetSearchJobParams extends SplunkBaseParams {
  sid: string
}

export interface SplunkGetSearchJobResponse extends ToolResponse {
  output: {
    sid: string | null
    label: string | null
    dispatchState: string | null
    doneProgress: number | null
    isDone: boolean | null
    isFailed: boolean | null
    isFinalized: boolean | null
    isPaused: boolean | null
    isZombie: boolean | null
    isSaved: boolean | null
    isSavedSearch: boolean | null
    isRealTimeSearch: boolean | null
    eventCount: number | null
    eventAvailableCount: number | null
    eventFieldCount: number | null
    resultCount: number | null
    resultPreviewCount: number | null
    scanCount: number | null
    runDuration: number | null
    priority: number | null
    earliestTime: string | null
    latestTime: string | null
    /** Epoch seconds. The job entry documents this pair as bare numbers. */
    searchEarliestTime: number | null
    searchLatestTime: number | null
    messages: Record<string, unknown> | null
  }
}

export interface SplunkGetSearchResultsParams extends SplunkBaseParams {
  sid: string
  count?: number
  offset?: number
  fields?: string
  addSummaryToMetadata?: boolean
}

export interface SplunkCancelSearchJobParams extends SplunkBaseParams {
  sid: string
}

export interface SplunkCancelSearchJobResponse extends ToolResponse {
  output: {
    sid: string
    messages: SplunkMessage[]
  }
}

export interface SplunkSavedSearch {
  name: string | null
  id: string | null
  author: string | null
  updated: string | null
  search: string | null
  qualifiedSearch: string | null
  description: string | null
  disabled: boolean | null
  isScheduled: boolean | null
  isVisible: boolean | null
  cronSchedule: string | null
  nextScheduledTime: string | null
  alertType: string | null
  dispatchEarliestTime: string | null
  dispatchLatestTime: string | null
}

export interface SplunkListSavedSearchesParams extends SplunkBaseParams {
  search?: string
  count?: number
  offset?: number
}

export interface SplunkListSavedSearchesResponse extends ToolResponse {
  output: {
    savedSearches: SplunkSavedSearch[]
    total: number | null
    offset: number | null
  }
}

export interface SplunkGetSavedSearchParams extends SplunkBaseParams {
  name: string
}

export interface SplunkGetSavedSearchResponse extends ToolResponse {
  output: SplunkSavedSearch
}

export interface SplunkDispatchSavedSearchParams extends SplunkBaseParams {
  name: string
  triggerActions?: boolean
  dispatchEarliestTime?: string
  dispatchLatestTime?: string
  dispatchMaxCount?: number
  dispatchMaxTime?: number
  dispatchTtl?: number
  forceDispatch?: boolean
}

export interface SplunkDispatchSavedSearchResponse extends ToolResponse {
  output: {
    sid: string
  }
}

export interface SplunkListFiredAlertsParams extends SplunkBaseParams {
  count?: number
  offset?: number
}

export interface SplunkListFiredAlertsResponse extends ToolResponse {
  output: {
    alerts: {
      name: string | null
      id: string | null
      updated: string | null
      triggeredAlertCount: number | null
    }[]
    total: number | null
    offset: number | null
  }
}

export interface SplunkGetFiredAlertsParams extends SplunkBaseParams {
  name: string
}

export interface SplunkGetFiredAlertsResponse extends ToolResponse {
  output: {
    firedAlerts: {
      name: string | null
      id: string | null
      updated: string | null
      savedSearchName: string | null
      alertType: string | null
      severity: number | null
      sid: string | null
      triggerTime: number | null
      triggerTimeRendered: string | null
      expirationTimeRendered: string | null
      triggeredAlerts: number | null
      actions: string | null
    }[]
  }
}

export interface SplunkListIndexesParams extends SplunkBaseParams {
  datatype?: string
  count?: number
  offset?: number
}

export interface SplunkListIndexesResponse extends ToolResponse {
  output: {
    indexes: {
      name: string | null
      id: string | null
      updated: string | null
      datatype: string | null
      disabled: boolean | null
      isInternal: boolean | null
      totalEventCount: number | null
      currentDBSizeMB: number | null
      maxTotalDataSizeMB: number | null
      frozenTimePeriodInSecs: number | null
      minTime: string | null
      maxTime: string | null
      homePath: string | null
      coldPath: string | null
      thawedPath: string | null
    }[]
    total: number | null
    offset: number | null
  }
}

export interface SplunkListAppsParams extends SplunkBaseParams {
  count?: number
  offset?: number
}

export interface SplunkListAppsResponse extends ToolResponse {
  output: {
    apps: {
      name: string | null
      id: string | null
      updated: string | null
      label: string | null
      version: string | null
      author: string | null
      description: string | null
      details: string | null
      disabled: boolean | null
      visible: boolean | null
      configured: boolean | null
      checkForUpdates: boolean | null
      stateChangeRequiresRestart: boolean | null
    }[]
    total: number | null
    offset: number | null
  }
}

/** Union of every Splunk tool response, used by the block's generic output typing. */
export type SplunkResponse =
  | SplunkSearchResultsResponse
  | SplunkCreateSearchJobResponse
  | SplunkGetSearchJobResponse
  | SplunkCancelSearchJobResponse
  | SplunkListSavedSearchesResponse
  | SplunkGetSavedSearchResponse
  | SplunkDispatchSavedSearchResponse
  | SplunkListFiredAlertsResponse
  | SplunkGetFiredAlertsResponse
  | SplunkListIndexesResponse
  | SplunkListAppsResponse

/** Output schema shared by the two tools that project a saved search. */
export const SAVED_SEARCH_OUTPUT_FIELDS: Record<string, OutputProperty> = {
  name: { type: 'string', description: 'Saved search name' },
  id: { type: 'string', description: 'Fully qualified REST URI of the saved search' },
  author: { type: 'string', description: 'Owner of the saved search' },
  updated: { type: 'string', description: 'Last update timestamp' },
  search: { type: 'string', description: 'The SPL the saved search runs' },
  qualifiedSearch: {
    type: 'string',
    description: 'The exact search string the scheduler runs',
    optional: true,
  },
  description: { type: 'string', description: 'Saved search description', optional: true },
  disabled: { type: 'boolean', description: 'Whether the saved search is disabled' },
  isScheduled: { type: 'boolean', description: 'Whether the search runs on a schedule' },
  isVisible: {
    type: 'boolean',
    description: 'Whether the search appears in the visible saved search list',
  },
  cronSchedule: { type: 'string', description: 'Cron schedule for the search', optional: true },
  nextScheduledTime: {
    type: 'string',
    description: 'Time the scheduler runs this search again',
    optional: true,
  },
  alertType: {
    type: 'string',
    description: 'Alert condition type (e.g. always, custom, number of events)',
    optional: true,
  },
  dispatchEarliestTime: {
    type: 'string',
    description: 'Earliest time bound used when the search is dispatched',
    optional: true,
  },
  dispatchLatestTime: {
    type: 'string',
    description: 'Latest time bound used when the search is dispatched',
    optional: true,
  },
}
