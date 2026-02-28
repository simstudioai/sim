import type { ToolResponse } from '@/tools/types'

/**
 * Base params shared by endpoints using API key in body.
 */
export interface AmplitudeApiKeyParams {
  apiKey: string
}

/**
 * Base params shared by endpoints using Basic Auth (api_key:secret_key).
 */
export interface AmplitudeBasicAuthParams {
  apiKey: string
  secretKey: string
}

/**
 * Send Event params (HTTP V2 API).
 */
export interface AmplitudeSendEventParams extends AmplitudeApiKeyParams {
  userId?: string
  deviceId?: string
  eventType: string
  eventProperties?: string
  userProperties?: string
  time?: string
  sessionId?: string
  insertId?: string
  appVersion?: string
  platform?: string
  country?: string
  language?: string
  ip?: string
  price?: string
  quantity?: string
  revenue?: string
  productId?: string
  revenueType?: string
}

export interface AmplitudeSendEventResponse extends ToolResponse {
  output: {
    code: number
    eventsIngested: number
    payloadSizeBytes: number
    serverUploadTime: number
  }
}

/**
 * Identify User params (Identify API).
 */
export interface AmplitudeIdentifyUserParams extends AmplitudeApiKeyParams {
  userId?: string
  deviceId?: string
  userProperties: string
}

export interface AmplitudeIdentifyUserResponse extends ToolResponse {
  output: {
    code: number
    message: string | null
  }
}

/**
 * Group Identify params (Group Identify API).
 */
export interface AmplitudeGroupIdentifyParams extends AmplitudeApiKeyParams {
  groupType: string
  groupValue: string
  groupProperties: string
}

export interface AmplitudeGroupIdentifyResponse extends ToolResponse {
  output: {
    code: number
    message: string | null
  }
}

/**
 * User Search params (Dashboard REST API).
 */
export interface AmplitudeUserSearchParams extends AmplitudeBasicAuthParams {
  user: string
}

export interface AmplitudeUserSearchResponse extends ToolResponse {
  output: {
    matches: Array<{
      amplitudeId: number
      userId: string | null
    }>
    type: string | null
  }
}

/**
 * User Activity params (Dashboard REST API).
 */
export interface AmplitudeUserActivityParams extends AmplitudeBasicAuthParams {
  amplitudeId: string
  offset?: string
  limit?: string
  direction?: string
}

export interface AmplitudeUserActivityResponse extends ToolResponse {
  output: {
    events: Array<{
      eventType: string
      eventTime: string
      eventProperties: Record<string, unknown>
      userProperties: Record<string, unknown>
      sessionId: number | null
      platform: string | null
      country: string | null
      city: string | null
    }>
    userData: {
      userId: string | null
      canonicalAmplitudeId: number | null
      numEvents: number | null
      numSessions: number | null
      platform: string | null
      country: string | null
    } | null
  }
}

/**
 * User Profile params (User Profile API).
 */
export interface AmplitudeUserProfileParams {
  secretKey: string
  userId?: string
  deviceId?: string
  getAmpProps?: string
  getCohortIds?: string
  getComputations?: string
}

export interface AmplitudeUserProfileResponse extends ToolResponse {
  output: {
    userId: string | null
    deviceId: string | null
    ampProps: Record<string, unknown> | null
    cohortIds: string[] | null
    computations: Record<string, unknown> | null
  }
}

/**
 * Event Segmentation params (Dashboard REST API).
 */
export interface AmplitudeEventSegmentationParams extends AmplitudeBasicAuthParams {
  eventType: string
  start: string
  end: string
  metric?: string
  interval?: string
  groupBy?: string
  limit?: string
}

export interface AmplitudeEventSegmentationResponse extends ToolResponse {
  output: {
    series: unknown[]
    seriesLabels: string[]
    seriesCollapsed: unknown[]
    xValues: string[]
  }
}

/**
 * Get Active Users params (Dashboard REST API).
 */
export interface AmplitudeGetActiveUsersParams extends AmplitudeBasicAuthParams {
  start: string
  end: string
  metric?: string
  interval?: string
}

export interface AmplitudeGetActiveUsersResponse extends ToolResponse {
  output: {
    series: number[][]
    seriesMeta: string[]
    xValues: string[]
  }
}

/**
 * Real-time Active Users params (Dashboard REST API).
 */
export interface AmplitudeRealtimeActiveUsersParams extends AmplitudeBasicAuthParams {}

export interface AmplitudeRealtimeActiveUsersResponse extends ToolResponse {
  output: {
    series: number[][]
    seriesLabels: string[]
    xValues: string[]
  }
}

/**
 * List Events params (Dashboard REST API).
 */
export interface AmplitudeListEventsParams extends AmplitudeBasicAuthParams {}

export interface AmplitudeListEventsResponse extends ToolResponse {
  output: {
    events: Array<{
      value: string
      displayName: string | null
      totals: number
      hidden: boolean
      deleted: boolean
    }>
  }
}

/**
 * Get Revenue params (Dashboard REST API).
 */
export interface AmplitudeGetRevenueParams extends AmplitudeBasicAuthParams {
  start: string
  end: string
  metric?: string
  interval?: string
}

export interface AmplitudeGetRevenueResponse extends ToolResponse {
  output: {
    series: unknown[]
    seriesLabels: string[]
    xValues: string[]
  }
}
