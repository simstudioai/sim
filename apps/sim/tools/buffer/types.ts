import { toArray, toRecord } from '@sim/utils/object'
import { readResponseToBufferWithLimit } from '@/lib/core/utils/stream-limits'
import { MAX_TOOL_RESPONSE_BODY_BYTES } from '@/lib/internal/tool-operations/response-limits'
import { bufferOutputProperties, bufferSelection, projectBufferObject } from '@/tools/buffer/schema'
import type { ToolResponse } from '@/tools/types'

export const BUFFER_API_URL = 'https://api.buffer.com'
export const BUFFER_SHARE_MODES = [
  'addToQueue',
  'shareNext',
  'shareNow',
  'customScheduled',
] as const
export const BUFFER_SCHEDULING_TYPES = ['automatic', 'notification'] as const
export const BUFFER_POST_STATUSES = [
  'draft',
  'needs_approval',
  'scheduled',
  'sending',
  'sent',
  'error',
] as const

type BufferShareMode = (typeof BUFFER_SHARE_MODES)[number]
type BufferSchedulingType = (typeof BUFFER_SCHEDULING_TYPES)[number]
interface BufferBaseParams {
  apiKey: string
}

/** Builds the Bearer token headers for Buffer's GraphQL API. */
export function bufferHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
}

/** Reads a bounded GraphQL envelope and rejects transport and provider errors. */
export async function parseBufferGraphQLResponse(
  response: Response
): Promise<Record<string, unknown>> {
  const bytes = await readResponseToBufferWithLimit(response, {
    maxBytes: MAX_TOOL_RESPONSE_BODY_BYTES,
    label: 'Buffer API response',
  })
  let payload: Record<string, unknown>
  try {
    payload = toRecord(JSON.parse(bytes.toString('utf8')))
  } catch {
    throw new Error(`Buffer API error (HTTP ${response.status})`)
  }
  const errors = toArray(payload.errors).map(toRecord)
  if (errors.length)
    throw new Error(typeof errors[0]?.message === 'string' ? errors[0].message : 'Buffer API error')
  if (!response.ok || !payload.data) throw new Error(`Buffer API error (HTTP ${response.status})`)
  return toRecord(payload.data)
}

export const BUFFER_POST_SELECTION = bufferSelection('Post')
export const BUFFER_IDEA_SELECTION = bufferSelection('Idea')
export const POST_OUTPUT_PROPERTIES = bufferOutputProperties('Post')
export const CHANNEL_OUTPUT_PROPERTIES = bufferOutputProperties('Channel')
export const ACCOUNT_OUTPUT_PROPERTIES = bufferOutputProperties('Account')
export const IDEA_OUTPUT_PROPERTIES = {
  ...bufferOutputProperties('Idea'),
  title: { type: 'string' as const, nullable: true, description: 'Idea content title' },
  text: { type: 'string' as const, nullable: true, description: 'Idea content text' },
}
export const IDEA_GROUP_OUTPUT_PROPERTIES = bufferOutputProperties('IdeaGroup')
export const PAGE_INFO_OUTPUT_PROPERTIES = bufferOutputProperties('PaginationPageInfo')

/** Projects the documented post fields, including network-specific metadata. */
export function mapBufferPost(value: unknown): BufferPost {
  return projectBufferObject('Post', value)
}

/** Projects the documented channel settings and network metadata. */
export function mapBufferChannel(value: unknown): BufferChannel {
  return projectBufferObject('Channel', value)
}

/** Projects account and organization details. */
export function mapBufferAccount(value: unknown): BufferAccount {
  return projectBufferObject('Account', value)
}
/** Projects all cursor pagination fields. */
export function mapBufferPageInfo(value: unknown): BufferPaginationPageInfo {
  return projectBufferObject('PaginationPageInfo', value)
}
/** Projects an idea board column. */
export function mapBufferIdeaGroup(value: unknown): BufferIdeaGroup {
  return projectBufferObject('IdeaGroup', value)
}

/** Keeps legacy title/text outputs alongside the complete idea content. */
export function mapBufferIdea(value: unknown): BufferIdea {
  const idea = projectBufferObject('Idea', value)
  return { ...idea, title: idea.content?.title ?? null, text: idea.content?.text ?? null }
}

export interface BufferAccount {
  id: string
  email: string
  backupEmail: string | null
  avatar: string
  createdAt: string | null
  organizations: Array<BufferOrganization>
  timezone: string | null
  name: string | null
  preferences: BufferPreferences | null
  connectedApps: Array<BufferConnectedApp> | null
}

export interface BufferAggregatedPostMetrics {
  metrics: Array<BufferPostMetric>
  metricsUpdatedAt: string | null
}

interface BufferAnnotation {
  content: string
  indices: Array<number>
  text: string
  type: string
  url: string
}

type BufferAsset = BufferDocumentAsset | BufferImageAsset | BufferVideoAsset

interface BufferAuthor {
  id: string
  avatar: string
  email: string
  isDeleted: boolean
  name: string | null
  urn: string | null
}

interface BufferBlueskyMetadata {
  __typename?: 'BlueskyMetadata'
  serverUrl: string
}

interface BufferBlueskyPostMetadata {
  __typename?: 'BlueskyPostMetadata'
  annotations: Array<BufferAnnotation>
  linkAttachment: BufferLinkAttachment | null
  thread: Array<BufferThreadedPost>
  threadCount: number
  type: string
}

export interface BufferChannel {
  id: string
  allowedActions: Array<string>
  avatar: string
  descriptor: string
  displayName: string | null
  externalLink: string | null
  hasActiveMemberDevice: boolean
  isDisconnected: boolean
  isLocked: boolean
  isNew: boolean
  isQueuePaused: boolean
  linkShortening: BufferChannelLinkShortening
  metadata: BufferChannelMetadata | null
  name: string
  organizationId: string
  postingGoal: BufferPostingGoal | null
  postingSchedule: Array<BufferScheduleV2>
  products: Array<string> | null
  scopes: Array<string | null>
  service: string
  serviceId: string
  showTrendingTopicSuggestions: boolean
  timezone: string
  type: string
  weeklyPostingLimit: BufferWeeklyPostingLimit | null
  createdAt: string
  updatedAt: string
}

interface BufferChannelLinkShortening {
  config: BufferLinkShorteningConfig | null
  isEnabled: boolean
}

type BufferChannelMetadata =
  | BufferInstagramMetadata
  | BufferTiktokMetadata
  | BufferYoutubeMetadata
  | BufferPinterestMetadata
  | BufferMastodonMetadata
  | BufferBlueskyMetadata
  | BufferGoogleBusinessMetadata
  | BufferFacebookMetadata
  | BufferTwitterMetadata
  | BufferLinkedInMetadata
  | BufferWhatsAppMetadata

interface BufferConnectedApp {
  category: string | null
  clientId: string
  description: string
  name: string
  scopes: Array<string>
  userId: string
  website: string
  createdAt: string
}

export interface BufferDailyPostingLimitStatus {
  channelId: string
  isAtLimit: boolean
  limit: number | null
  scheduled: number
  sent: number
}

interface BufferDocumentAsset {
  __typename?: 'DocumentAsset'
  id: string | null
  document: BufferDocumentMetadata
  mimeType: string
  source: string
  thumbnail: string
  type: string
}

interface BufferDocumentMetadata {
  filesize: number | null
  numPages: number
  thumbnails: Array<string>
  title: string | null
}

interface BufferFacebookMetadata {
  __typename?: 'FacebookMetadata'
  locationData: BufferLocationData | null
}

interface BufferFacebookPostMetadata {
  __typename?: 'FacebookPostMetadata'
  annotations: Array<BufferAnnotation>
  firstComment: string | null
  linkAttachment: BufferLinkAttachment | null
  title: string | null
  type: string
}

interface BufferGoogleBusinessEventMetaData {
  __typename?: 'GoogleBusinessEventMetaData'
  button: string
  endDate: string
  endTime: string | null
  isFullDayEvent: boolean
  link: string | null
  startDate: string
  startTime: string | null
  title: string
}

interface BufferGoogleBusinessMetadata {
  __typename?: 'GoogleBusinessMetadata'
  locationData: BufferLocationData | null
}

interface BufferGoogleBusinessOfferMetaData {
  __typename?: 'GoogleBusinessOfferMetaData'
  code: string | null
  endDate: string
  link: string | null
  startDate: string
  terms: string | null
  title: string
}

type BufferGoogleBusinessPostDetails =
  | BufferGoogleBusinessWhatsNewMetaData
  | BufferGoogleBusinessOfferMetaData
  | BufferGoogleBusinessEventMetaData

interface BufferGoogleBusinessPostMetadata {
  __typename?: 'GoogleBusinessPostMetadata'
  annotations: Array<BufferAnnotation>
  details: BufferGoogleBusinessPostDetails | null
  title: string | null
  type: string
}

interface BufferGoogleBusinessWhatsNewMetaData {
  __typename?: 'GoogleBusinessWhatsNewMetaData'
  button: string
  link: string | null
}

export interface BufferIdea {
  id: string
  content: BufferIdeaContent
  groupId: string | null
  organizationId: string
  position: number | null
  createdAt: number
  updatedAt: number
  title: string | null
  text: string | null
}

interface BufferIdeaContent {
  aiAssisted: boolean
  date: string | null
  media: Array<BufferIdeaMedia> | null
  services: Array<string>
  tags: Array<BufferPublishingTag>
  text: string | null
  title: string | null
}

export interface BufferIdeaGroup {
  id: string
  isLocked: boolean
  name: string
}

interface BufferIdeaMedia {
  id: string
  alt: string | null
  size: number | null
  source: BufferIdeaMediaSource | null
  thumbnailUrl: string | null
  type: string
  url: string
}

interface BufferIdeaMediaSource {
  id: string | null
  author: string | null
  authorUrl: string | null
  name: string
}

interface BufferImageAsset {
  __typename?: 'ImageAsset'
  id: string | null
  image: BufferImageMetadata
  mimeType: string
  source: string
  thumbnail: string
  type: string
}

interface BufferImageMetadata {
  altText: string
  animatedThumbnail: string | null
  height: number
  isAnimated: boolean
  userTags: Array<BufferUserTag> | null
  width: number
}

interface BufferInstagramGeolocation {
  id: string | null
  text: string | null
}

interface BufferInstagramMetadata {
  __typename?: 'InstagramMetadata'
  defaultToReminders: boolean
}

interface BufferInstagramPostMetadata {
  __typename?: 'InstagramPostMetadata'
  annotations: Array<BufferAnnotation>
  firstComment: string | null
  geolocation: BufferInstagramGeolocation | null
  isAiGenerated: boolean
  link: string | null
  shouldShareToFeed: boolean
  stickerFields: BufferInstagramStickerFields | null
  type: string
}

interface BufferInstagramStickerFields {
  music: string | null
  other: string | null
  products: string | null
  text: string | null
  topics: string | null
}

interface BufferLinkAttachment {
  expandedUrl: string | null
  text: string
  thumbnail: string | null
  thumbnails: Array<string>
  title: string
  url: string
}

interface BufferLinkShorteningConfig {
  domain: string
  name: string
}

interface BufferLinkedInMetadata {
  __typename?: 'LinkedInMetadata'
  shouldShowLinkedinAnalyticsRefreshBanner: boolean
}

interface BufferLinkedInPostMetadata {
  __typename?: 'LinkedInPostMetadata'
  annotations: Array<BufferAnnotation>
  firstComment: string | null
  linkAttachment: BufferLinkAttachment | null
  type: string
}

interface BufferLocationData {
  googleAccountId: string | null
  location: string | null
  mapsLink: string | null
}

interface BufferMastodonMetadata {
  __typename?: 'MastodonMetadata'
  maxCharacters: number
  serverUrl: string
}

interface BufferMastodonPostMetadata {
  __typename?: 'MastodonPostMetadata'
  annotations: Array<BufferAnnotation>
  spoilerText: string | null
  thread: Array<BufferThreadedPost>
  threadCount: number
  type: string
}

interface BufferMemberConnection {
  totalCount: number
}

interface BufferNote {
  id: string
  allowedActions: Array<string>
  author: BufferAuthor
  text: string
  type: string
  createdAt: string
  updatedAt: string | null
}

interface BufferOrganization {
  id: string
  channelCount: number
  limits: BufferOrganizationLimits
  members: BufferMemberConnection
  name: string
  ownerEmail: string
  shouldEnforce2FASetup: boolean
}

interface BufferOrganizationLimits {
  channels: number
  generateContent: number
  ideaGroups: number
  ideas: number
  members: number
  postTemplates: number
  savedReplies: number
  scheduledPosts: number
  scheduledStoriesPerChannel: number
  scheduledThreadsPerChannel: number
  tags: number
}

export interface BufferPaginationPageInfo {
  endCursor: string | null
  hasNextPage: boolean
  hasPreviousPage: boolean
  startCursor: string | null
}

interface BufferPinterestBoard {
  id: string
  avatar: string | null
  description: string | null
  name: string
  serviceId: string
  url: string
}

interface BufferPinterestMetadata {
  __typename?: 'PinterestMetadata'
  boards: Array<BufferPinterestBoard>
}

interface BufferPinterestPostMetadata {
  __typename?: 'PinterestPostMetadata'
  annotations: Array<BufferAnnotation>
  board: BufferPinterestBoard | null
  title: string | null
  type: string
  url: string | null
}

export interface BufferPost {
  id: string
  allowedActions: Array<string>
  assets: Array<BufferAsset>
  author: BufferAuthor | null
  channel: BufferChannel
  channelId: string
  channelService: string
  contentItemId: string | null
  dueAt: string | null
  error: BufferPostPublishingError | null
  externalLink: string | null
  ideaId: string | null
  isCustomScheduled: boolean
  metadata: BufferPostMetadata | null
  metrics: Array<BufferPostMetric> | null
  metricsUpdatedAt: string | null
  notes: Array<BufferNote>
  notificationStatus: string | null
  schedulingType: string | null
  sentAt: string | null
  sharedNow: boolean
  shareMode: string
  status: string
  tags: Array<BufferTag>
  text: string
  via: string
  createdAt: string
  updatedAt: string
}

type BufferPostMetadata =
  | BufferInstagramPostMetadata
  | BufferFacebookPostMetadata
  | BufferLinkedInPostMetadata
  | BufferTwitterPostMetadata
  | BufferPinterestPostMetadata
  | BufferGoogleBusinessPostMetadata
  | BufferYoutubePostMetadata
  | BufferMastodonPostMetadata
  | BufferTiktokPostMetadata
  | BufferThreadsPostMetadata
  | BufferBlueskyPostMetadata
  | BufferSubstackPostMetadata

interface BufferPostMetric {
  description: string
  name: string
  type: string
  unit: string
  value: number
}

interface BufferPostPublishingError {
  message: string
  rawError: string | null
  supportUrl: string | null
}

interface BufferPostingGoal {
  goal: number
  periodEnd: string
  periodStart: string
  scheduledCount: number
  sentCount: number
  status: string
}

interface BufferPreferences {
  timeFormat: string | null
  startOfWeek: string | null
  defaultScheduleOption: string
}

interface BufferPublishingTag {
  id: string
  color: string
  colorName: string | null
  name: string
}

interface BufferRetweetMetadata {
  id: string
  text: string
  thumbnails: Array<string>
  url: string
  user: BufferRetweetUserMetadata
  createdAt: string
}

interface BufferRetweetUserMetadata {
  avatar: string
  name: string
  username: string
}

interface BufferScheduleV2 {
  day: string
  paused: boolean
  times: Array<string>
}

interface BufferSubstackPostMetadata {
  __typename?: 'SubstackPostMetadata'
  annotations: Array<BufferAnnotation>
  linkAttachment: BufferLinkAttachment | null
  type: string
}

interface BufferTag {
  id: string
  color: string
  colorName: string | null
  isLocked: boolean
  name: string
}

interface BufferThreadItemBlueskyMetadata {
  linkAttachment: BufferLinkAttachment | null
}

interface BufferThreadItemMetadata {
  bluesky: BufferThreadItemBlueskyMetadata | null
  threads: BufferThreadItemThreadsMetadata | null
}

interface BufferThreadItemThreadsMetadata {
  linkAttachment: BufferLinkAttachment | null
}

interface BufferThreadedPost {
  assets: Array<BufferAsset>
  linkAttachment: BufferLinkAttachment | null
  metadata: BufferThreadItemMetadata | null
  text: string
}

interface BufferThreadsPostMetadata {
  __typename?: 'ThreadsPostMetadata'
  annotations: Array<BufferAnnotation>
  linkAttachment: BufferLinkAttachment | null
  locationId: string | null
  locationName: string | null
  thread: Array<BufferThreadedPost>
  threadCount: number
  topic: string | null
  type: string
}

interface BufferTiktokMetadata {
  __typename?: 'TiktokMetadata'
  defaultToReminders: boolean
}

interface BufferTiktokPostMetadata {
  __typename?: 'TiktokPostMetadata'
  annotations: Array<BufferAnnotation>
  isAiGenerated: boolean
  title: string | null
  type: string
}

interface BufferTwitterMetadata {
  __typename?: 'TwitterMetadata'
  subscriptionType: string | null
}

interface BufferTwitterPostMetadata {
  __typename?: 'TwitterPostMetadata'
  annotations: Array<BufferAnnotation>
  isAiGenerated: boolean
  retweet: BufferRetweetMetadata | null
  thread: Array<BufferThreadedPost>
  threadCount: number
  type: string
}

interface BufferUserTag {
  handle: string
  x: number
  y: number
}

interface BufferVideoAsset {
  __typename?: 'VideoAsset'
  id: string | null
  mimeType: string
  source: string
  thumbnail: string
  type: string
  video: BufferVideoMetadata
}

interface BufferVideoMetadata {
  audioCodec: string | null
  containerFormat: string | null
  durationMs: number
  fileSize: number | null
  frameRate: number | null
  height: number
  isTranscodingRequired: boolean
  isVideoProcessing: boolean
  rotationDegree: number | null
  thumbnailOffset: number | null
  title: string | null
  videoBitRate: number | null
  videoCodec: string | null
  width: number
}

interface BufferWeeklyPostingLimit {
  limit: number
  scheduled: number
  sent: number
}

interface BufferWhatsAppMetadata {
  __typename?: 'WhatsAppMetadata'
  businessPortfolioId: string
  lastSubscribedAt: string | null
  phoneNumberId: string
  wabaId: string
}

interface BufferYoutubeCategory {
  categoryId: string
  title: string
}

interface BufferYoutubeMetadata {
  __typename?: 'YoutubeMetadata'
  defaultToReminders: boolean
}

interface BufferYoutubePostMetadata {
  __typename?: 'YoutubePostMetadata'
  annotations: Array<BufferAnnotation>
  category: BufferYoutubeCategory | null
  embeddable: boolean
  isAiGenerated: boolean
  license: string | null
  madeForKids: boolean
  notifySubscribers: boolean
  privacy: string | null
  title: string | null
  type: string
}

export interface BufferCreatePostParams extends BufferBaseParams {
  channelId: string
  text?: string | null
  mode: BufferShareMode
  schedulingType?: BufferSchedulingType
  dueAt?: string
  saveToDraft?: boolean
  media?: unknown
  mediaType?: 'auto' | 'image' | 'video'
  mediaAltText?: string
  assets?: unknown
  metadata?: unknown
  aiAssisted?: boolean
  draftId?: string
  ideaId?: string
  source?: string
  tagIds?: unknown
  needsApproval?: boolean
}

export interface BufferEditPostParams extends BufferBaseParams {
  postId: string
  text?: string | null
  mode?: BufferShareMode | null
  schedulingType?: BufferSchedulingType | null
  dueAt?: string
  saveToDraft?: boolean
  media?: unknown
  mediaType?: 'auto' | 'image' | 'video'
  mediaAltText?: string
  assets?: unknown
  metadata?: unknown
  aiAssisted?: boolean
  draftId?: string
  ideaId?: string
  source?: string
  tagIds?: unknown
  approvalChange?: string
}

export interface BufferDeletePostParams extends BufferBaseParams {
  postId: string
}

export interface BufferGetPostParams extends BufferBaseParams {
  postId: string
}

export interface BufferGetPostsParams extends BufferBaseParams {
  organizationId: string
  channelIds?: string
  status?: string
  limit?: number
  after?: string
  sortBy?: string
  sortDirection?: string
  filter?: unknown
  sort?: unknown
}

export interface BufferGetChannelsParams extends BufferBaseParams {
  organizationId: string
  filter?: unknown
}

export interface BufferGetAccountParams extends BufferBaseParams {
  organizationFilter?: unknown
}

export interface BufferCreateIdeaParams extends BufferBaseParams {
  organizationId: string
  text?: string
  title?: string
  groupId?: string
  content?: unknown
  group?: unknown
  cta?: string
  templateId?: string
}

export interface BufferGetIdeasParams extends BufferBaseParams {
  organizationId: string
  groupFilter?: unknown
  tagsFilter?: unknown
  limit?: number
  after?: string
}

export interface BufferGetIdeaGroupsParams extends BufferBaseParams {
  organizationId: string
}

export interface BufferPostResponse extends ToolResponse {
  output: {
    post: BufferPost
  }
}

export interface BufferDeletePostResponse extends ToolResponse {
  output: {
    deleted: boolean
    id: string
  }
}

export interface BufferPostsResponse extends ToolResponse {
  output: {
    posts: BufferPost[]
    edges: { cursor: string; node: BufferPost }[]
    pageInfo: BufferPaginationPageInfo
  }
}

export interface BufferChannelsResponse extends ToolResponse {
  output: {
    channels: BufferChannel[]
  }
}

export interface BufferAccountResponse extends ToolResponse {
  output: {
    account: BufferAccount
  }
}

export interface BufferIdeaResponse extends ToolResponse {
  output: {
    idea: BufferIdea
  }
}

export interface BufferIdeasResponse extends ToolResponse {
  output: {
    ideas: BufferIdea[]
    edges: { cursor: string; node: BufferIdea }[]
    pageInfo: BufferPaginationPageInfo
  }
}

export interface BufferIdeaGroupsResponse extends ToolResponse {
  output: {
    ideaGroups: BufferIdeaGroup[]
  }
}

export interface BufferGetChannelParams extends BufferBaseParams {
  channelId: string
}
export interface BufferChannelResponse extends ToolResponse {
  output: { channel: BufferChannel }
}
export interface BufferAggregatedMetricsParams extends BufferBaseParams {
  organizationId: string
  startDateTime: string
  endDateTime: string
  channelIds?: unknown
  tags?: unknown
}
export interface BufferAggregatedMetricsResponse extends ToolResponse {
  output: { aggregatedPostMetrics: BufferAggregatedPostMetrics }
}
export interface BufferDailyLimitsParams extends BufferBaseParams {
  channelIds: unknown
  date?: string
}
export interface BufferDailyLimitsResponse extends ToolResponse {
  output: { limits: BufferDailyPostingLimitStatus[] }
}

/** Bounds each request to one page without silently fetching additional results. */
export function bufferPageSize(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 100)
    throw new Error('Page size must be an integer from 1 to 100 (integration limit)')
  return value
}

/** Accepts workflow JSON arrays and the block's comma-separated ID convenience input. */
export function bufferStringList(value: unknown): string[] {
  const parsed: unknown =
    typeof value === 'string'
      ? value.trim().startsWith('[')
        ? JSON.parse(value)
        : value
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
      : value
  if (
    !Array.isArray(parsed) ||
    !parsed.every((entry): entry is string => typeof entry === 'string')
  )
    throw new Error('Expected an array of string IDs')
  return parsed
}
