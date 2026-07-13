import type { OutputProperty, ToolResponse } from '@/tools/types'

/** Single GraphQL endpoint for the Buffer API. */
export const BUFFER_API_URL = 'https://api.buffer.com'

/** Valid values for the `mode` argument of createPost/editPost. */
export const BUFFER_SHARE_MODES = [
  'addToQueue',
  'shareNext',
  'shareNow',
  'customScheduled',
] as const

/** Valid values for the `schedulingType` argument of createPost/editPost. */
export const BUFFER_SCHEDULING_TYPES = ['automatic', 'notification'] as const

/** Valid post status filter values for the posts query. */
export const BUFFER_POST_STATUSES = [
  'draft',
  'needs_approval',
  'scheduled',
  'sending',
  'sent',
  'error',
] as const

export type BufferShareMode = (typeof BUFFER_SHARE_MODES)[number]
export type BufferSchedulingType = (typeof BUFFER_SCHEDULING_TYPES)[number]
export type BufferPostStatus = (typeof BUFFER_POST_STATUSES)[number]

/** Every Buffer tool authenticates with the account API key as a Bearer token. */
interface BufferBaseParams {
  apiKey: string
}

/**
 * Builds the standard headers shared by every Buffer GraphQL request.
 */
export function bufferHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Parses a Buffer GraphQL response and returns its `data` payload.
 * Throws with a readable message when the transport fails or the
 * response carries top-level GraphQL errors.
 */
export async function parseBufferGraphQLResponse(response: Response): Promise<Record<string, any>> {
  let payload: { data?: Record<string, any>; errors?: Array<{ message?: string }> }
  try {
    payload = await response.json()
  } catch {
    throw new Error(`Buffer API error (HTTP ${response.status})`)
  }
  if (payload.errors?.length) {
    throw new Error(payload.errors[0]?.message || 'Buffer API error')
  }
  if (!payload.data) {
    throw new Error(`Buffer API returned no data (HTTP ${response.status})`)
  }
  return payload.data
}

/** GraphQL selection set shared by every operation that returns a Post. */
export const BUFFER_POST_SELECTION = `
  id
  text
  status
  via
  channelId
  channelService
  schedulingType
  shareMode
  isCustomScheduled
  sharedNow
  createdAt
  updatedAt
  dueAt
  sentAt
  externalLink
  error {
    message
    supportUrl
    rawError
  }
  assets {
    id
    type
    mimeType
    source
    thumbnail
  }
`

// region Shared object shapes

export interface BufferAsset {
  id: string | null
  type: string
  mimeType: string
  source: string
  thumbnail: string
}

export interface BufferPostError {
  message: string
  supportUrl: string | null
  rawError: string | null
}

export interface BufferPost {
  id: string
  text: string
  status: string
  via: string
  channelId: string
  channelService: string
  schedulingType: string | null
  shareMode: string
  isCustomScheduled: boolean
  sharedNow: boolean
  createdAt: string
  updatedAt: string
  dueAt: string | null
  sentAt: string | null
  externalLink: string | null
  error: BufferPostError | null
  assets: BufferAsset[]
}

export interface BufferChannel {
  id: string
  name: string
  displayName: string | null
  service: string
  serviceId: string
  avatar: string
  timezone: string
  type: string
  isQueuePaused: boolean
  isDisconnected: boolean
  organizationId: string
}

export interface BufferOrganization {
  id: string
  name: string
  channelCount: number
  ownerEmail: string
}

export interface BufferAccount {
  id: string
  email: string
  name: string | null
  timezone: string | null
  organizations: BufferOrganization[]
}

export interface BufferIdea {
  id: string
  organizationId: string
  groupId: string | null
  title: string | null
  text: string | null
}

export interface BufferIdeaGroup {
  id: string
  name: string
  isLocked: boolean
}

export interface BufferPageInfo {
  hasNextPage: boolean
  endCursor: string | null
}

// endregion

// region Response mappers

/** GraphQL selection set shared by every operation that returns an Idea. */
export const BUFFER_IDEA_SELECTION = `
  id
  organizationId
  groupId
  content {
    title
    text
  }
`

/**
 * Maps a raw GraphQL Idea node onto the stable output shape.
 */
export function mapBufferIdea(idea: Record<string, any>): BufferIdea {
  return {
    id: idea.id,
    organizationId: idea.organizationId ?? '',
    groupId: idea.groupId ?? null,
    title: idea.content?.title ?? null,
    text: idea.content?.text ?? null,
  }
}

/**
 * Maps a raw GraphQL Post node onto the stable output shape.
 */
export function mapBufferPost(post: Record<string, any>): BufferPost {
  return {
    id: post.id,
    text: post.text ?? '',
    status: post.status ?? '',
    via: post.via ?? '',
    channelId: post.channelId ?? '',
    channelService: post.channelService ?? '',
    schedulingType: post.schedulingType ?? null,
    shareMode: post.shareMode ?? '',
    isCustomScheduled: post.isCustomScheduled ?? false,
    sharedNow: post.sharedNow ?? false,
    createdAt: post.createdAt ?? '',
    updatedAt: post.updatedAt ?? '',
    dueAt: post.dueAt ?? null,
    sentAt: post.sentAt ?? null,
    externalLink: post.externalLink ?? null,
    error: post.error
      ? {
          message: post.error.message ?? '',
          supportUrl: post.error.supportUrl ?? null,
          rawError: post.error.rawError ?? null,
        }
      : null,
    assets: (post.assets ?? []).map((asset: Record<string, any>) => ({
      id: asset.id ?? null,
      type: asset.type ?? '',
      mimeType: asset.mimeType ?? '',
      source: asset.source ?? '',
      thumbnail: asset.thumbnail ?? '',
    })),
  }
}

/**
 * Maps a raw GraphQL Channel node onto the stable output shape.
 */
export function mapBufferChannel(channel: Record<string, any>): BufferChannel {
  return {
    id: channel.id,
    name: channel.name ?? '',
    displayName: channel.displayName ?? null,
    service: channel.service ?? '',
    serviceId: channel.serviceId ?? '',
    avatar: channel.avatar ?? '',
    timezone: channel.timezone ?? '',
    type: channel.type ?? '',
    isQueuePaused: channel.isQueuePaused ?? false,
    isDisconnected: channel.isDisconnected ?? false,
    organizationId: channel.organizationId ?? '',
  }
}

// endregion

// region Output property maps

export const POST_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Post ID' },
  text: { type: 'string', description: 'Post text content' },
  status: {
    type: 'string',
    description: 'Post status (draft, needs_approval, scheduled, sending, sent, error)',
  },
  via: { type: 'string', description: 'How the post was created (buffer, network, api)' },
  channelId: { type: 'string', description: 'Channel the post belongs to' },
  channelService: { type: 'string', description: 'Social network of the channel' },
  schedulingType: {
    type: 'string',
    nullable: true,
    description: 'How the post publishes (automatic or notification)',
  },
  shareMode: { type: 'string', description: 'Share mode used for the post' },
  isCustomScheduled: { type: 'boolean', description: 'Whether the post has a custom schedule' },
  sharedNow: { type: 'boolean', description: 'Whether the post was shared immediately' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last update timestamp (ISO 8601)' },
  dueAt: { type: 'string', nullable: true, description: 'Scheduled publish time (ISO 8601)' },
  sentAt: { type: 'string', nullable: true, description: 'Publish timestamp (ISO 8601)' },
  externalLink: {
    type: 'string',
    nullable: true,
    description: 'Link to the published post on the social network',
  },
  error: {
    type: 'object',
    nullable: true,
    description: 'Publishing error details when the post failed',
    properties: {
      message: { type: 'string', description: 'Error message' },
      supportUrl: { type: 'string', nullable: true, description: 'Support article URL' },
      rawError: { type: 'string', nullable: true, description: 'Raw error from the network' },
    },
  },
  assets: {
    type: 'array',
    description: 'Media attached to the post',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', nullable: true, description: 'Asset ID' },
        type: { type: 'string', description: 'Asset type' },
        mimeType: { type: 'string', description: 'MIME type of the asset' },
        source: { type: 'string', description: 'Source URL of the asset' },
        thumbnail: { type: 'string', description: 'Thumbnail URL of the asset' },
      },
    },
  },
}

export const CHANNEL_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Channel ID' },
  name: { type: 'string', description: 'Channel name' },
  displayName: { type: 'string', nullable: true, description: 'Channel display name' },
  service: { type: 'string', description: 'Social network (instagram, linkedin, twitter, ...)' },
  serviceId: { type: 'string', description: 'ID of the account on the social network' },
  avatar: { type: 'string', description: 'Channel avatar URL' },
  timezone: { type: 'string', description: 'Channel timezone' },
  type: { type: 'string', description: 'Channel type (page, profile, business, ...)' },
  isQueuePaused: { type: 'boolean', description: 'Whether the posting queue is paused' },
  isDisconnected: { type: 'boolean', description: 'Whether the channel needs reconnection' },
  organizationId: { type: 'string', description: 'Organization the channel belongs to' },
}

export const ACCOUNT_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Account ID' },
  email: { type: 'string', description: 'Account email' },
  name: { type: 'string', nullable: true, description: 'Account holder name' },
  timezone: { type: 'string', nullable: true, description: 'Account timezone' },
  organizations: {
    type: 'array',
    description: 'Organizations the account belongs to',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Organization ID' },
        name: { type: 'string', description: 'Organization name' },
        channelCount: { type: 'number', description: 'Number of connected channels' },
        ownerEmail: { type: 'string', description: 'Email of the organization owner' },
      },
    },
  },
}

export const IDEA_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Idea ID' },
  organizationId: { type: 'string', description: 'Organization the idea belongs to' },
  groupId: { type: 'string', nullable: true, description: 'Idea group ID' },
  title: { type: 'string', nullable: true, description: 'Idea title' },
  text: { type: 'string', nullable: true, description: 'Idea text content' },
}

export const IDEA_GROUP_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Idea group ID' },
  name: { type: 'string', description: 'Idea group name' },
  isLocked: { type: 'boolean', description: 'Whether the group is locked' },
}

export const PAGE_INFO_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  hasNextPage: { type: 'boolean', description: 'Whether more results are available' },
  endCursor: {
    type: 'string',
    nullable: true,
    description: 'Cursor to pass as "after" for the next page',
  },
}

// endregion

// region Tool params

export interface BufferCreatePostParams extends BufferBaseParams {
  channelId: string
  text?: string
  mode: BufferShareMode
  schedulingType?: BufferSchedulingType
  dueAt?: string
  saveToDraft?: boolean
  media?: unknown
  mediaAltText?: string
}

export interface BufferEditPostParams extends BufferBaseParams {
  postId: string
  text?: string
  mode: BufferShareMode
  schedulingType?: BufferSchedulingType
  dueAt?: string
  saveToDraft?: boolean
  media?: unknown
  mediaAltText?: string
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
}

export interface BufferGetChannelsParams extends BufferBaseParams {
  organizationId: string
}

export type BufferGetAccountParams = BufferBaseParams

export interface BufferCreateIdeaParams extends BufferBaseParams {
  organizationId: string
  text: string
  title?: string
  groupId?: string
}

export interface BufferGetIdeasParams extends BufferBaseParams {
  organizationId: string
  limit?: number
  after?: string
}

export interface BufferGetIdeaGroupsParams extends BufferBaseParams {
  organizationId: string
}

// endregion

// region Tool responses

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
    pageInfo: BufferPageInfo
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
    pageInfo: BufferPageInfo
  }
}

export interface BufferIdeaGroupsResponse extends ToolResponse {
  output: {
    ideaGroups: BufferIdeaGroup[]
  }
}

// endregion
