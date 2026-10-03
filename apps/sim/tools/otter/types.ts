import type { ToolResponse } from '@/tools/types'

/** An Otter user as returned inside owners, assignees, shares, and member lists. */
export interface OtterUser {
  id: string
  name: string | null
  firstName: string | null
  lastName: string | null
  email: string | null
}

export interface OtterChannel {
  id: string
  name: string | null
  memberCount: number | null
  owner: OtterUser | null
  discoverability: string | null
}

export interface OtterCalendarGuest {
  name: string | null
  email: string | null
  permission: string | null
}

export interface OtterSharedEmail {
  email: string | null
  user: OtterUser | null
  permission: string | null
}

export interface OtterSharedChannel {
  channel: OtterChannel | null
  permission: string | null
}

interface OtterProcessStatus {
  abstractSummary: string | null
  actionItem: string | null
  outline: string | null
}

export interface OtterConversation {
  id: string
  title: string | null
  url: string | null
  owner: OtterUser | null
  createdAt: string | null
  processStatus: OtterProcessStatus | null
  calendarGuests: OtterCalendarGuest[]
  sharedEmails: OtterSharedEmail[]
  sharedChannels: OtterSharedChannel[]
  abstractSummary: string | null
  confJoinUrl: string | null
}

interface OtterActionItemStatus {
  completed: boolean | null
  createdAt: string | null
  lastModifiedAt: string | null
  completedAt: string | null
}

export interface OtterActionItem {
  id: string
  text: string | null
  assignee: OtterUser | null
  status: OtterActionItemStatus | null
}

export interface OtterInsight {
  topic: string | null
  text: string[]
}

export interface OtterOutlineSection {
  section: string | null
  text: string[]
}

export interface OtterTranscript {
  content: string | null
  format: string | null
}

export interface OtterCustomPrompt {
  label: string | null
  output: string | null
}

export interface OtterConversationDetail extends OtterConversation {
  actionItems: OtterActionItem[] | null
  insights: OtterInsight[] | null
  outline: OtterOutlineSection[] | null
  transcript: OtterTranscript | null
  customPrompt: OtterCustomPrompt | null
}

export interface OtterWorkspace {
  workspaceId: number | null
  name: string | null
  owner: OtterUser | null
  memberCount: number | null
  handle: string | null
  type: string | null
}

interface OtterBaseParams {
  apiKey: string
}

export interface OtterListConversationsParams extends OtterBaseParams {
  includeShared?: boolean
  channelId?: string
  limit?: number
  cursor?: string
}

export interface OtterGetConversationParams extends OtterBaseParams {
  conversationId: string
  include: string
}

export interface OtterGetConversationAudioParams extends OtterBaseParams {
  conversationId: string
}

export interface OtterCreateConversationParams extends OtterBaseParams {
  fileUrl: string
  name?: string
}

export type OtterListChannelsParams = OtterBaseParams

export interface OtterListChannelMembersParams extends OtterBaseParams {
  channelId: string
}

export type OtterGetWorkspaceParams = OtterBaseParams

export interface OtterListWorkspaceConversationsParams extends OtterBaseParams {
  workspaceId: string
  limit?: number
  cursor?: string
}

export interface OtterListConversationsResponse extends ToolResponse {
  output: {
    conversations: OtterConversation[]
    retrievedAt: string | null
    hasMore: boolean
    nextCursor: string | null
  }
}

export interface OtterGetConversationResponse extends ToolResponse {
  output: OtterConversationDetail & { retrievedAt: string | null }
}

export interface OtterGetConversationAudioResponse extends ToolResponse {
  output: {
    audioUrl: string | null
    retrievedAt: string | null
  }
}

export interface OtterCreateConversationResponse extends ToolResponse {
  output: {
    status: string | null
    completedAt: string | null
    file: string | null
  }
}

export interface OtterListChannelsResponse extends ToolResponse {
  output: {
    channels: OtterChannel[]
    retrievedAt: string | null
  }
}

export interface OtterListChannelMembersResponse extends ToolResponse {
  output: {
    members: OtterUser[]
    retrievedAt: string | null
  }
}

export interface OtterGetWorkspaceResponse extends ToolResponse {
  output: OtterWorkspace & { retrievedAt: string | null }
}
