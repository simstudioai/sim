/**
 * Clockify API Types
 * Base URL: https://api.clockify.me/api/v1
 * Reports URL: https://reports.api.clockify.me/v1
 */

import type { ToolResponse } from '@/tools/types'

// ---------------------------------------------------------------------------
// Shared entity types
// ---------------------------------------------------------------------------

/** Represents a Clockify workspace */
export interface ClockifyWorkspace {
  id: string
  name: string
  imageUrl?: string
  memberships?: string[]
}

/** Represents a Clockify user */
export interface ClockifyUser {
  id: string
  name: string
  email: string
  status: string
  profilePicture: string
  activeWorkspace: string
  defaultWorkspace: string
  memberships: string[]
}

/** Represents a member's profile within a workspace */
export interface ClockifyMemberProfile {
  workCapacity: string
  costRate: string
  weeklyWorkingDays: string[]
}

/** Represents a Clockify project */
export interface ClockifyProject {
  id: string
  name: string
  clientId: string
  clientName: string
  color: string
  archived: boolean
  billable: boolean
  public: boolean
  note: string
  duration: string
  memberships: string[]
}

/** Represents a time interval with start, end, and duration */
export interface ClockifyTimeInterval {
  start: string
  end: string
  duration: string
}

/** Represents a Clockify time entry */
export interface ClockifyTimeEntry {
  id: string
  description: string
  timeInterval: ClockifyTimeInterval
  projectId: string
  taskId: string
  billable: boolean
  tags: string[]
  userId: string
  workspaceId: string
  isLocked: boolean
}

/** Represents a time-off period with optional half-day flag */
export interface ClockifyTimeOffPeriod {
  period: {
    start: string
    end: string
  }
  halfDay?: boolean
}

/** Represents a time-off request */
export interface ClockifyTimeOffRequest {
  id: string
  userId: string
  policyId: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  timeOffPeriod: ClockifyTimeOffPeriod
  note?: string
  balanceDiff?: number
}

/** Represents a holiday entry */
export interface ClockifyHoliday {
  id: string
  name: string
  date: string
  recurring: boolean
}

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

/** Filter criteria for Clockify reports */
export interface ClockifyReportFilter {
  dateRangeStart: string
  dateRangeEnd: string
  users?: {
    ids: string[]
    contains: 'CONTAINS' | 'DOES_NOT_CONTAIN'
  }
  projects?: {
    ids: string[]
    contains: 'CONTAINS' | 'DOES_NOT_CONTAIN'
  }
}

/** A group entry in a summary report, which may contain nested children */
export interface ClockifySummaryReportGroup {
  _id: string
  name: string
  duration: number
  amount: number
  children?: ClockifySummaryReportGroup[]
}

/** A single entry in a detailed report */
export interface ClockifyDetailedReportEntry {
  _id: string
  description: string
  timeInterval: {
    start: string
    end: string
    duration: number
  }
  projectName: string
  userName: string
  tags: string[]
}

/** A single entry in a weekly report */
export interface ClockifyWeeklyReportEntry {
  _id: string
  userName: string
  totalTime: number
  days: Record<string, number>
}

/** A single entry in an attendance report */
export interface ClockifyAttendanceEntry {
  userId: string
  userName: string
  date: string
  firstEntry: string
  lastEntry: string
  totalTime: number
}

// ---------------------------------------------------------------------------
// Tool params and responses
// ---------------------------------------------------------------------------

/** Params for retrieving the current authenticated user */
export interface ClockifyGetCurrentUserParams {
  apiKey: string
}

/** Response for retrieving the current authenticated user */
export interface ClockifyGetCurrentUserResponse extends ToolResponse {
  output: ClockifyUser
}

/** Params for listing all workspaces */
export interface ClockifyGetWorkspacesParams {
  apiKey: string
}

/** Response for listing all workspaces */
export interface ClockifyGetWorkspacesResponse extends ToolResponse {
  output: {
    workspaces: ClockifyWorkspace[]
  }
}

/** Params for listing users in a workspace */
export interface ClockifyGetUsersParams {
  apiKey: string
  workspaceId: string
}

/** Response for listing users in a workspace */
export interface ClockifyGetUsersResponse extends ToolResponse {
  output: {
    users: ClockifyUser[]
  }
}

/** Params for retrieving a member profile */
export interface ClockifyGetMemberProfileParams {
  apiKey: string
  workspaceId: string
  userId: string
}

/** Response for retrieving a member profile */
export interface ClockifyGetMemberProfileResponse extends ToolResponse {
  output: ClockifyMemberProfile
}

/** Params for listing projects in a workspace */
export interface ClockifyGetProjectsParams {
  apiKey: string
  workspaceId: string
}

/** Response for listing projects in a workspace */
export interface ClockifyGetProjectsResponse extends ToolResponse {
  output: {
    projects: ClockifyProject[]
  }
}

/** Params for generating a summary report */
export interface ClockifyReportSummaryParams {
  apiKey: string
  workspaceId: string
  dateRangeStart: string
  dateRangeEnd: string
  userIds?: string
  projectIds?: string
}

/** Response for a summary report */
export interface ClockifyReportSummaryResponse extends ToolResponse {
  output: {
    groups: ClockifySummaryReportGroup[]
    totals: {
      totalTime: number
      totalBillableTime: number
      entriesCount: number
    }
  }
}

/** Params for generating a detailed report */
export interface ClockifyReportDetailedParams {
  apiKey: string
  workspaceId: string
  dateRangeStart: string
  dateRangeEnd: string
  userIds?: string
  projectIds?: string
}

/** Response for a detailed report */
export interface ClockifyReportDetailedResponse extends ToolResponse {
  output: {
    timeentries: ClockifyDetailedReportEntry[]
    totals: {
      totalTime: number
      totalBillableTime: number
      entriesCount: number
    }
  }
}

/** Params for generating a weekly report */
export interface ClockifyReportWeeklyParams {
  apiKey: string
  workspaceId: string
  dateRangeStart: string
  dateRangeEnd: string
  userIds?: string
  projectIds?: string
}

/** Response for a weekly report */
export interface ClockifyReportWeeklyResponse extends ToolResponse {
  output: {
    weeks: ClockifyWeeklyReportEntry[]
    totals: {
      totalTime: number
    }
  }
}

/** Params for generating an attendance report */
export interface ClockifyReportAttendanceParams {
  apiKey: string
  workspaceId: string
  dateRangeStart: string
  dateRangeEnd: string
  userIds?: string
  projectIds?: string
}

/** Response for an attendance report */
export interface ClockifyReportAttendanceResponse extends ToolResponse {
  output: {
    attendance: ClockifyAttendanceEntry[]
  }
}

/** Params for listing time entries for a user */
export interface ClockifyGetTimeEntriesParams {
  apiKey: string
  workspaceId: string
  userId: string
  start?: string
  end?: string
}

/** Response for listing time entries */
export interface ClockifyGetTimeEntriesResponse extends ToolResponse {
  output: {
    timeEntries: ClockifyTimeEntry[]
  }
}

/** Params for retrieving a single time entry */
export interface ClockifyGetTimeEntryParams {
  apiKey: string
  workspaceId: string
  timeEntryId: string
}

/** Response for retrieving a single time entry */
export interface ClockifyGetTimeEntryResponse extends ToolResponse {
  output: ClockifyTimeEntry
}

/** Params for listing in-progress time entries across a workspace */
export interface ClockifyGetInProgressParams {
  apiKey: string
  workspaceId: string
}

/** Response for listing in-progress time entries */
export interface ClockifyGetInProgressResponse extends ToolResponse {
  output: {
    timeEntries: ClockifyTimeEntry[]
  }
}

/** Params for listing time-off requests */
export interface ClockifyGetTimeOffParams {
  apiKey: string
  workspaceId: string
  start?: string
  end?: string
}

/** Response for listing time-off requests */
export interface ClockifyGetTimeOffResponse extends ToolResponse {
  output: {
    requests: ClockifyTimeOffRequest[]
  }
}

/** Params for listing holidays in a workspace */
export interface ClockifyGetHolidaysParams {
  apiKey: string
  workspaceId: string
  start?: string
  end?: string
}

/** Response for listing holidays */
export interface ClockifyGetHolidaysResponse extends ToolResponse {
  output: {
    holidays: ClockifyHoliday[]
  }
}
