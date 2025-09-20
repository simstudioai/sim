import type { ToolResponse } from '@/tools/types'

export interface WebexListRoomsParams {
  accessToken: string
  teamId?: string
  type?: string
  from?: string
  to?: string
  max?: number
}

export interface WebexListRoomsResponse extends ToolResponse {
  output: {
    message: string
    results: any
  }
}

export interface WebexListRoom {
  id?: string
  classificationId?: string
  created?: string
  creatorId?: string
  description?: string
  lastActivity?: string
  madePublic?: string
  ownerId?: string
  teamId?: string
  title?: string
  type?: string
  isAnnouncementOnly?: boolean
  isLocked?: boolean
  isPublic?: boolean
  isReadOnly?: boolean
}

export interface WebexListRooms {
  items: WebexListRoom[]
}

export interface WebexListMessagesParams {
  accessToken: string
  roomId: string
  max?: number
  mentionedPeople?: string
  before?: string
  beforeMessage?: string
}

export interface WebexListMessage {
  created?: string
  html?: string
  id?: string
  markdown?: string
  parentId?: string
  personEmail?: string
  personId?: string
  roomId?: string
  roomType?: string
  text?: string
  updated?: string
  isVoiceClip?: boolean
  files?: string[]
  mentionedGroups?: string[]
  mentionedPeople?: string[]
}

export interface WebexListMessages {
  items: WebexListMessage[]
}

export interface WebexListMessagesResponse extends ToolResponse {
  output: {
    message: string
    results: any
  }
}

export interface WebexCreateMessage {
  created?: string
  html?: string
  id?: string
  markdown?: string
  parentId?: string
  personEmail?: string
  personId?: string
  roomId?: string
  roomType?: string
  text?: string
  updated?: string
  isVoiceClip?: boolean
  files?: string[]
  mentionedGroups?: string[]
  mentionedPeople?: string[]
}

export interface WebexCreateMessageParams {
  accessToken: string
  markdown?: string
  parentId?: string
  roomId?: string
  text?: string
  toPersonEmail?: string
  toPersonId?: string
  files?: string
}

export interface WebexCreateMessageResponse extends ToolResponse {
  output: {
    message: string
    results: any
    createdId?: string
  }
}

export interface WebexEditMessageParams {
  accessToken: string
  messageId: string
  roomId: string
  markdown?: string
  text?: string
}

export interface WebexEditMessage {
  created?: string
  html?: string
  id?: string
  markdown?: string
  parentId?: string
  personEmail?: string
  personId?: string
  roomId?: string
  roomType?: string
  text?: string
  updated?: string
  isVoiceClip?: boolean
  files?: string[]
  mentionedGroups?: string[]
  mentionedPeople?: string[]
}

export interface WebexEditMessageResponse extends ToolResponse {
  output: {
    message: string
    results: any
  }
}

export type WebexResponse = WebexListMessagesResponse | WebexListRoomsResponse | WebexCreateMessageResponse | WebexEditMessageResponse
