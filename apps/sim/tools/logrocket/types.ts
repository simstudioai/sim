import type { ToolResponse } from '@/tools/types'

/**
 * Every LogRocket REST endpoint is scoped to an organization and an application
 * (called the "project id" in the dashboard), and authenticates with an API key
 * sent as `Authorization: token <key>`.
 */
interface LogRocketBaseParams {
  apiKey: string
  orgId: string
  appId: string
  /** Override for Private Cloud deployments. Defaults to https://api.logrocket.com. */
  apiHost?: string
}

/**
 * Request Galileo session highlights for a user (Session Highlights API).
 */
export interface LogRocketRequestHighlightsParams extends LogRocketBaseParams {
  userEmail?: string
  userID?: string
  question?: string
  /** Start of the session window, in milliseconds since epoch. */
  startMs?: string
  /** End of the session window, in milliseconds since epoch. */
  endMs?: string
  webhookURL?: string
}

export interface LogRocketRequestHighlightsResponse extends ToolResponse {
  output: {
    id: string
  }
}

/**
 * Retrieve the result of a previously requested highlights job.
 */
export interface LogRocketGetHighlightsParams extends LogRocketBaseParams {
  id: string
}

export interface LogRocketGetHighlightsResponse extends ToolResponse {
  output: {
    /** PENDING, READY, or FAILED. */
    status: string
    requestID: string | null
    appID: string | null
    /** Markdown summary across all sessions. Present only when status is READY. */
    highlights: string | null
    sessions: Array<{
      recordingID: string | null
      sessionID: number | null
      highlights: string | null
    }>
  }
}

/**
 * List exported session files (Data Export API).
 */
export interface LogRocketListExportedSessionsParams extends LogRocketBaseParams {
  cursor?: string
  limit?: string
  /** Unix timestamp in milliseconds to start listing from. */
  date?: string
}

export interface LogRocketListExportedSessionsResponse extends ToolResponse {
  output: {
    sessions: Array<{ url: string | null }>
    cursor: string | null
  }
}

/**
 * Read the organization audit log (Audit Log API).
 */
export interface LogRocketGetAuditLogsParams extends LogRocketBaseParams {
  limit?: string
  cursor?: string
}

export interface LogRocketGetAuditLogsResponse extends ToolResponse {
  output: {
    logs: Array<{
      time: string | null
      createdDate: string | null
      user: string | null
      action: string | null
      description: string | null
    }>
    cursor: string | null
    hasNext: boolean
  }
}

/**
 * Register a release so uploaded source maps can decode its stack traces.
 */
export interface LogRocketCreateReleaseParams extends LogRocketBaseParams {
  version: string
}

export interface LogRocketCreateReleaseResponse extends ToolResponse {
  output: {
    version: string
  }
}

/**
 * Create or update a user profile (User Identification API).
 */
export interface LogRocketIdentifyUserParams extends LogRocketBaseParams {
  userId: string
  name?: string
  email?: string
  /** Unix timestamp in milliseconds describing when the submitted data was true. */
  timestamp?: string
  /** JSON object of custom traits. Each value is stored as a string. */
  traits?: string
}

export interface LogRocketIdentifyUserResponse extends ToolResponse {
  output: {
    userID: string | null
    name: string | null
    email: string | null
    traits: Record<string, string>
  }
}
