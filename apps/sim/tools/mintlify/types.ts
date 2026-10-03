import type { ToolResponse } from '@/tools/types'

/** Every Mintlify endpoint authenticates with a bearer API key. */
interface MintlifyBaseParams {
  apiKey: string
}

/** Admin-key endpoints are scoped to a documentation project. */
interface MintlifyProjectParams extends MintlifyBaseParams {
  projectId: string
}

/** Assistant-key endpoints are scoped to a deployment domain identifier. */
interface MintlifyDomainParams extends MintlifyBaseParams {
  domain: string
}

/** Shared date-range and pagination filters used by the analytics export endpoints. */
interface MintlifyAnalyticsParams extends MintlifyProjectParams {
  dateFrom?: string
  dateTo?: string
}

export interface MintlifyTriggerUpdateParams extends MintlifyProjectParams {}

export interface MintlifyTriggerUpdateResponse extends ToolResponse {
  output: {
    statusId: string | null
  }
}

export interface MintlifyGetUpdateStatusParams extends MintlifyBaseParams {
  statusId: string
}

export interface MintlifyUpdateAuthor {
  name: string | null
  avatarUrl: string | null
  githubUserId: number | null
}

export interface MintlifyUpdateCommit {
  sha: string | null
  ref: string | null
  message: string | null
  filesChanged: {
    added: string[]
    modified: string[]
    removed: string[]
  } | null
}

export interface MintlifyGetUpdateStatusResponse extends ToolResponse {
  output: {
    id: string | null
    projectId: string | null
    createdAt: string | null
    endedAt: string | null
    status: string | null
    summary: string | null
    logs: string[]
    subdomain: string | null
    screenshot: string | null
    screenshotLight: string | null
    screenshotDark: string | null
    author: MintlifyUpdateAuthor | null
    commit: MintlifyUpdateCommit | null
    source: string | null
  }
}

export interface MintlifyTriggerPreviewParams extends MintlifyProjectParams {
  branch: string
}

export interface MintlifyTriggerPreviewResponse extends ToolResponse {
  output: {
    statusId: string | null
    previewUrl: string | null
  }
}

export interface MintlifyTriggerAutomationParams extends MintlifyProjectParams {
  automationId: string
}

export interface MintlifyTriggerAutomationResponse extends ToolResponse {
  output: {
    schemaId: string | null
    instanceId: string | null
    jobId: string | null
  }
}

export interface MintlifyDetectAiProseParams extends MintlifyProjectParams {
  path: string
  content: string
}

export interface MintlifyDeslopRewrite {
  text: string
  rationale: string
}

export interface MintlifyDeslopWindow {
  text: string
  label: string
  aiAssistanceScore: number | null
  confidence: string | number | null
  startLine: number | null
  endLine: number | null
  rewrites: MintlifyDeslopRewrite[]
}

export interface MintlifyDetectAiProseResponse extends ToolResponse {
  output: {
    path: string | null
    skipped: string | null
    predictionShort: string | null
    fractionAi: number | null
    fractionAiAssisted: number | null
    fractionHuman: number | null
    windows: MintlifyDeslopWindow[]
    creditsCharged: number | null
  }
}

/** Shape returned by all three agent-job endpoints. */
export interface MintlifyAgentJobOutput {
  id: string | null
  status: string | null
  source: {
    repository: string | null
    ref: string | null
  } | null
  model: string | null
  prLink: string | null
  createdAt: string | null
  archivedAt: string | null
}

export interface MintlifyAgentJobResponse extends ToolResponse {
  output: MintlifyAgentJobOutput
}

export interface MintlifyCreateAgentJobParams extends MintlifyProjectParams {
  prompt: string
}

export interface MintlifyGetAgentJobParams extends MintlifyProjectParams {
  jobId: string
}

export interface MintlifySendAgentMessageParams extends MintlifyProjectParams {
  jobId: string
  prompt: string
}

export interface MintlifySearchParams extends MintlifyDomainParams {
  query: string
  pageSize?: number
  scoreThreshold?: number
  version?: string
  language?: string
  tag?: string
  groups?: string[] | string
}

export interface MintlifySearchResult {
  content: string | null
  path: string | null
  metadata: Record<string, unknown> | null
}

export interface MintlifySearchResponse extends ToolResponse {
  output: {
    results: MintlifySearchResult[]
    resultCount: number
  }
}

export interface MintlifyGetPageContentParams extends MintlifyDomainParams {
  path: string
  groups?: string[] | string
}

export interface MintlifyGetPageContentResponse extends ToolResponse {
  output: {
    path: string | null
    content: string | null
  }
}

export interface MintlifyAssistantContextItem {
  type: string
  value: string
  path?: string
  elementId?: string
}

export interface MintlifyCreateAssistantMessageParams extends MintlifyDomainParams {
  message?: string
  messages?: unknown[] | string
  fp?: string
  threadId?: string
  retrievalPageSize?: number
  currentPath?: string
  version?: string
  language?: string
  groups?: string[] | string
  assistantContext?: MintlifyAssistantContextItem[] | string
}

export interface MintlifyAssistantSource {
  sourceId: string | null
  url: string | null
  title: string | null
}

export interface MintlifyCreateAssistantMessageResponse extends ToolResponse {
  output: {
    text: string
    threadId: string | null
    sources: MintlifyAssistantSource[]
  }
}

export interface MintlifyGetFeedbackParams extends MintlifyAnalyticsParams {
  source?: string
  status?: string
  limit?: number
  cursor?: string
}

export interface MintlifyFeedbackEntry {
  id: string | null
  path: string | null
  comment: string | null
  createdAt: string | null
  source: string | null
  status: string | null
  helpful: boolean | null
  contact: string | null
  code: string | null
  filename: string | null
  lang: string | null
}

export interface MintlifyGetFeedbackResponse extends ToolResponse {
  output: {
    feedback: MintlifyFeedbackEntry[]
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface MintlifyGetFeedbackByPageParams extends MintlifyAnalyticsParams {
  limit?: number
  source?: string
  status?: string
}

export interface MintlifyFeedbackPageEntry {
  path: string | null
  thumbsUp: number | null
  thumbsDown: number | null
  code: number | null
  total: number | null
}

export interface MintlifyGetFeedbackByPageResponse extends ToolResponse {
  output: {
    feedback: MintlifyFeedbackPageEntry[]
    hasMore: boolean
  }
}

export interface MintlifyGetAssistantConversationsParams extends MintlifyAnalyticsParams {
  limit?: number
  cursor?: string
}

export interface MintlifyConversationSource {
  title: string | null
  url: string | null
}

export interface MintlifyConversation {
  id: string | null
  timestamp: string | null
  query: string | null
  response: string | null
  sources: MintlifyConversationSource[]
  resolutionStatus: string | null
  queryCategory: string | null
  pageUrl: string | null
}

export interface MintlifyGetAssistantConversationsResponse extends ToolResponse {
  output: {
    conversations: MintlifyConversation[]
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface MintlifyGetAssistantCallerStatsParams extends MintlifyAnalyticsParams {}

export interface MintlifyGetAssistantCallerStatsResponse extends ToolResponse {
  output: {
    web: number | null
    api: number | null
    other: number | null
    total: number | null
  }
}

export interface MintlifyGetSearchesParams extends MintlifyAnalyticsParams {
  limit?: number
  cursor?: string
}

export interface MintlifySearchQueryRow {
  searchQuery: string | null
  hits: number | null
  ctr: number | null
  topClickedPage: string | null
  lastSearchedAt: string | null
}

export interface MintlifyGetSearchesResponse extends ToolResponse {
  output: {
    searches: MintlifySearchQueryRow[]
    totalSearches: number | null
    nextCursor: string | null
  }
}

/** Human / AI / total split shared by the views and visitors endpoints. */
export interface MintlifyTrafficTotals {
  human: number | null
  ai: number | null
  total: number | null
}

export interface MintlifyTrafficRow extends MintlifyTrafficTotals {
  path: string | null
}

export interface MintlifyGetViewsParams extends MintlifyAnalyticsParams {
  limit?: number
  offset?: number
}

export interface MintlifyGetViewsResponse extends ToolResponse {
  output: {
    totals: MintlifyTrafficTotals | null
    views: MintlifyTrafficRow[]
    hasMore: boolean
  }
}

export interface MintlifyGetVisitorsParams extends MintlifyAnalyticsParams {
  limit?: number
  offset?: number
}

export interface MintlifyGetVisitorsResponse extends ToolResponse {
  output: {
    totals: MintlifyTrafficTotals | null
    visitors: MintlifyTrafficRow[]
    hasMore: boolean
  }
}
