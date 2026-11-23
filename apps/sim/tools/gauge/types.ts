import type { ToolResponse } from '@/tools/types'

interface GaugeAuthParams {
  accessToken: string
}

interface GaugeAPIKeyInfo {
  id: string
  name: string
  prefix: string
  organization: GaugeOrganization
}

export interface GaugeMe {
  user: GaugeUserInfo | null
  apiKey: GaugeAPIKeyInfo | null
  token: GaugeTokenInfo
}

interface GaugeOrganization {
  id: string
  slug: string
  name: string
}

interface GaugeTokenInfo {
  kind: 'session' | 'api_key'
  scopes: string[]
  expiresAt: string | null
}

interface GaugeUserInfo {
  id: string
  email: string
  name: string
}

export interface GaugeDirectoryOrganization {
  id: string
  slug: string
  name: string
  products: GaugeOrganizationProducts
}

export interface GaugeOrganizationList {
  data: GaugeDirectoryOrganization[]
  nextCursor?: string | null
}

interface GaugeOrganizationProducts {
  chat: boolean
  agents: boolean | null
}

export interface GaugeCategory {
  id: string
  slug: string
  name: string
  description: string
}

export interface GaugeCategoryList {
  data: GaugeCategory[]
  nextCursor?: string | null
}

export interface GaugeTopic {
  id: string
  slug: string
  title: string
  promptCount: number
  createdAt: string
}

export interface GaugeTopicList {
  data: GaugeTopic[]
  nextCursor?: string | null
}

export interface GaugePromptList {
  data: GaugePromptOut[]
  nextCursor?: string | null
}

export interface GaugePromptOut {
  id: string
  text: string
  topicId: string | null
  trackingType: string
  tagIds: string[]
  createdAt: string
  firstAnswerDay: string | null
}

export interface GaugeCreatePromptsOut {
  results: GaugeCreateResult[]
  dryRun: boolean
  remaining: number | null
}

interface GaugeCreateResult {
  index: number
  status: 'created' | 'already_exists' | 'would_create'
  prompt?: GaugePromptOut | null
}

export interface GaugePromptIn {
  text: string
  topicId: string
  trackingType?: 'visibility' | 'branded_own'
  tagIds?: string[]
}

export interface GaugeBulkPatchOut {
  updated: string[]
  notFound: string[]
}

export interface GaugePromptTagsOut {
  promptIds: string[]
}

export interface GaugeTag {
  id: string
  name: string
  color: string
  promptCount: number
}

export interface GaugeTagList {
  data: GaugeTag[]
  nextCursor?: string | null
}

export interface GaugeBrandList {
  data: GaugeBrandOut[]
  nextCursor?: string | null
}

interface GaugeBrandOut {
  id: string
  name: string
  slug: string
  website: string
  role: 'owned' | 'competitor'
}

interface GaugeColumn {
  key: string
  kind: 'dimension' | 'metric'
  type: string
  unit?: string | null
}

interface GaugeDateRangeOut {
  since: string
  until: string
}

interface GaugeFreshnessOut {
  watermark: string | null
  pending: number
  available: boolean
}

export interface GaugeQueryOut {
  columns: GaugeColumn[]
  rows: Record<string, unknown>[]
  labels: Record<string, Record<string, Record<string, unknown>>>
  dateRange: GaugeDateRangeOut
  truncated: boolean
  cached: boolean
  freshness: GaugeFreshnessOut
}

interface GaugeAnswerItem {
  id: string
  promptId: string
  topicId: string | null
  model: string
  day: string
  createdAt: string
  text: string
  brandIds: string[]
}

export interface GaugeAnswerList {
  data: GaugeAnswerItem[]
  nextCursor?: string | null
}

export interface GaugeAnswerDetail {
  id: string
  promptId: string
  promptText: string
  topicId: string | null
  model: string
  day: string
  createdAt: string
  text: string
  mentions: GaugeMention[]
  citations: GaugeCitedPage[]
  searchQueries: string[]
}

interface GaugeCitedPage {
  pageId: string
  url: string
  title: string | null
  domain: string
}

interface GaugeMention {
  brandId: string
  name: string
  mentionTypes: string[]
  count: number
}

interface GaugeCitationItem {
  answerId: string
  pageId: string
  promptId: string
  model: string
  day: string
  domain: string
  url: string
}

export interface GaugeCitationList {
  data: GaugeCitationItem[]
  nextCursor?: string | null
}

export interface GaugeGetCurrentCredentialParams extends GaugeAuthParams {}

export interface GaugeGetCurrentCredentialResponse extends ToolResponse {
  output: {
    user: GaugeUserInfo | null
    apiKey: GaugeAPIKeyInfo | null
    token: GaugeTokenInfo
  }
}

export interface GaugeListOrganizationsParams extends GaugeAuthParams {}

export interface GaugeListOrganizationsResponse extends ToolResponse {
  output: {
    organizations: GaugeDirectoryOrganization[]
    nextCursor: string | null
  }
}

export interface GaugeGetOrganizationParams extends GaugeAuthParams {
  org: string
}

export interface GaugeGetOrganizationResponse extends ToolResponse {
  output: {
    organization: GaugeDirectoryOrganization
  }
}

export interface GaugeListCategoriesParams extends GaugeAuthParams {
  org: string
}

export interface GaugeListCategoriesResponse extends ToolResponse {
  output: {
    categories: GaugeCategory[]
    nextCursor: string | null
  }
}

export interface GaugeGetCategoryParams extends GaugeAuthParams {
  org: string
  category: string
}

export interface GaugeGetCategoryResponse extends ToolResponse {
  output: {
    category: GaugeCategory
  }
}

export interface GaugeListTopicsParams extends GaugeAuthParams {
  org: string
  category: string
  cursor?: string | null
  limit?: number
}

export interface GaugeListTopicsResponse extends ToolResponse {
  output: {
    topics: GaugeTopic[]
    nextCursor: string | null
  }
}

export interface GaugeCreateTopicParams extends GaugeAuthParams {
  org: string
  category: string
  title: string
}

export interface GaugeCreateTopicResponse extends ToolResponse {
  output: {
    topic: GaugeTopic
  }
}

export interface GaugeGetTopicParams extends GaugeAuthParams {
  org: string
  category: string
  topicId: string
}

export interface GaugeGetTopicResponse extends ToolResponse {
  output: {
    topic: GaugeTopic
  }
}

export interface GaugeRenameTopicParams extends GaugeAuthParams {
  org: string
  category: string
  topicId: string
  title: string
}

export interface GaugeRenameTopicResponse extends ToolResponse {
  output: {
    topic: GaugeTopic
  }
}

export interface GaugeListPromptsParams extends GaugeAuthParams {
  org: string
  category: string
  topic?: string | null
  tag?: unknown
  trackingType?: 'visibility' | 'branded_own' | 'all'
  cursor?: string | null
  limit?: number
}

export interface GaugeListPromptsResponse extends ToolResponse {
  output: {
    prompts: GaugePromptOut[]
    nextCursor: string | null
  }
}

export interface GaugeCreatePromptsParams extends GaugeAuthParams {
  org: string
  category: string
  dryRun?: boolean
  prompts: unknown
}

export interface GaugeCreatePromptsResponse extends ToolResponse {
  output: {
    results: GaugeCreateResult[]
    dryRun: boolean
    remaining: number | null
  }
}

export interface GaugeBulkUpdatePromptsParams extends GaugeAuthParams {
  org: string
  category: string
  topicId?: string | null
  trackingType?: 'visibility' | 'branded_own' | null
  ids: unknown
}

export interface GaugeBulkUpdatePromptsResponse extends ToolResponse {
  output: {
    updated: string[]
    notFound: string[]
  }
}

export interface GaugeAddTagsToPromptsParams extends GaugeAuthParams {
  org: string
  category: string
  promptIds: unknown
  tagIds: unknown
}

export interface GaugeAddTagsToPromptsResponse extends ToolResponse {
  output: {
    promptIds: string[]
  }
}

export interface GaugeRemoveTagsFromPromptsParams extends GaugeAuthParams {
  org: string
  category: string
  promptIds: unknown
  tagIds: unknown
}

export interface GaugeRemoveTagsFromPromptsResponse extends ToolResponse {
  output: {
    promptIds: string[]
  }
}

export interface GaugeGetPromptParams extends GaugeAuthParams {
  org: string
  category: string
  promptId: string
}

export interface GaugeGetPromptResponse extends ToolResponse {
  output: {
    prompt: GaugePromptOut
  }
}

export interface GaugeUpdatePromptParams extends GaugeAuthParams {
  org: string
  category: string
  promptId: string
  topicId?: string | null
  trackingType?: 'visibility' | 'branded_own' | null
}

export interface GaugeUpdatePromptResponse extends ToolResponse {
  output: {
    prompt: GaugePromptOut
  }
}

export interface GaugeListTagsParams extends GaugeAuthParams {
  org: string
}

export interface GaugeListTagsResponse extends ToolResponse {
  output: {
    tags: GaugeTag[]
    nextCursor: string | null
  }
}

export interface GaugeCreateTagParams extends GaugeAuthParams {
  org: string
  name: string
  color?: string
}

export interface GaugeCreateTagResponse extends ToolResponse {
  output: {
    tag: GaugeTag
  }
}

export interface GaugeGetTagParams extends GaugeAuthParams {
  org: string
  tagId: string
}

export interface GaugeGetTagResponse extends ToolResponse {
  output: {
    tag: GaugeTag
  }
}

export interface GaugeUpdateTagParams extends GaugeAuthParams {
  org: string
  tagId: string
  name?: string | null
  color?: string | null
}

export interface GaugeUpdateTagResponse extends ToolResponse {
  output: {
    tag: GaugeTag
  }
}

export interface GaugeDeleteTagParams extends GaugeAuthParams {
  org: string
  tagId: string
}

export interface GaugeDeleteTagResponse extends ToolResponse {
  output: {
    tagId: string
    deleted: boolean
  }
}

export interface GaugeListBrandsParams extends GaugeAuthParams {
  org: string
  category: string
}

export interface GaugeListBrandsResponse extends ToolResponse {
  output: {
    brands: GaugeBrandOut[]
    nextCursor: string | null
  }
}

export interface GaugeQueryParams extends GaugeAuthParams {
  org: string
  dataset: 'answers' | 'citations' | 'searchQueries' | 'aiTraffic'
  dimensions?: unknown
  metrics: unknown
  filters?: unknown
  where?: unknown
  dateRange?: unknown
  granularity?: 'hour' | 'day' | 'week' | 'month'
  orderBy?: unknown
  limit?: number
}

export interface GaugeQueryResponse extends ToolResponse {
  output: {
    columns: GaugeColumn[]
    rows: Record<string, unknown>[]
    labels: Record<string, Record<string, Record<string, unknown>>>
    dateRange: GaugeDateRangeOut
    truncated: boolean
    cached: boolean
    freshness: GaugeFreshnessOut
  }
}

export interface GaugeGetQueryMetadataParams extends GaugeAuthParams {
  org: string
  dataset?: string | null
}

export interface GaugeGetQueryMetadataResponse extends ToolResponse {
  output: {
    catalog: Record<string, unknown>
  }
}

export interface GaugeListAnswersParams extends GaugeAuthParams {
  org: string
  category: string
  since?: string | null
  until?: string | null
  model?: unknown
  prompt?: unknown
  topic?: unknown
  tag?: unknown
  trackingType?: 'visibility' | 'branded_own' | 'all'
  cursor?: string | null
  limit?: number
  brand?: unknown
  brandAbsent?: unknown
}

export interface GaugeListAnswersResponse extends ToolResponse {
  output: {
    answers: GaugeAnswerItem[]
    nextCursor: string | null
  }
}

export interface GaugeGetAnswerParams extends GaugeAuthParams {
  org: string
  category: string
  answerId: string
}

export interface GaugeGetAnswerResponse extends ToolResponse {
  output: {
    answer: GaugeAnswerDetail
  }
}

export interface GaugeListCitationsParams extends GaugeAuthParams {
  org: string
  category: string
  since?: string | null
  until?: string | null
  model?: unknown
  prompt?: unknown
  topic?: unknown
  tag?: unknown
  trackingType?: 'visibility' | 'branded_own' | 'all'
  cursor?: string | null
  limit?: number
  domain?: unknown
  page?: unknown
}

export interface GaugeListCitationsResponse extends ToolResponse {
  output: {
    citations: GaugeCitationItem[]
    nextCursor: string | null
  }
}
