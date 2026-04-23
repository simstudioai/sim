import type { ToolResponse } from '@/tools/types'

export interface AgentPhoneNumber {
  id: string
  phoneNumber: string
  country: string
  status: string
  type: string
  agentId: string | null
  createdAt: string
}

export interface AgentPhoneNumberMessage {
  id: string
  from_: string
  to: string
  body: string
  direction: string
  channel: string | null
  receivedAt: string
}

export interface AgentPhoneConversationSummary {
  id: string
  agentId: string | null
  phoneNumberId: string
  phoneNumber: string
  participant: string
  lastMessageAt: string
  lastMessagePreview: string
  messageCount: number
  metadata: Record<string, unknown> | null
  createdAt: string
}

export interface AgentPhoneConversationMessage {
  id: string
  body: string
  fromNumber: string
  toNumber: string
  direction: string
  channel: string | null
  mediaUrl: string | null
  receivedAt: string
}

export interface AgentPhoneConversationDetail {
  id: string
  agentId: string | null
  phoneNumberId: string
  phoneNumber: string
  participant: string
  lastMessageAt: string
  messageCount: number
  metadata: Record<string, unknown> | null
  createdAt: string
  messages: AgentPhoneConversationMessage[]
}

export interface AgentPhoneCallSummary {
  id: string
  agentId: string | null
  phoneNumberId: string | null
  phoneNumber: string | null
  fromNumber: string
  toNumber: string
  direction: string
  status: string
  startedAt: string | null
  endedAt: string | null
  durationSeconds: number | null
  lastTranscriptSnippet: string | null
  recordingUrl: string | null
  recordingAvailable: boolean | null
}

export interface AgentPhoneTranscriptTurn {
  id: string
  transcript: string
  confidence: number | null
  response: string | null
  createdAt: string
}

export interface AgentPhoneTranscriptEntry {
  role: string
  content: string
  createdAt: string | null
}

export interface AgentPhoneCallDetail extends AgentPhoneCallSummary {
  transcripts: AgentPhoneTranscriptTurn[]
}

export interface AgentPhoneContact {
  id: string
  phoneNumber: string
  name: string
  email: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface AgentPhoneCreateNumberParams {
  apiKey: string
  country?: string
  areaCode?: string
  agentId?: string
}

export interface AgentPhoneCreateNumberResult extends ToolResponse {
  output: AgentPhoneNumber
}

export interface AgentPhoneListNumbersParams {
  apiKey: string
  limit?: number
  offset?: number
}

export interface AgentPhoneListNumbersResult extends ToolResponse {
  output: {
    data: AgentPhoneNumber[]
    hasMore: boolean
    total: number
  }
}

export interface AgentPhoneReleaseNumberParams {
  apiKey: string
  numberId: string
}

export interface AgentPhoneReleaseNumberResult extends ToolResponse {
  output: {
    id: string
    released: boolean
  }
}

export interface AgentPhoneGetNumberMessagesParams {
  apiKey: string
  numberId: string
  limit?: number
  before?: string
  after?: string
}

export interface AgentPhoneGetNumberMessagesResult extends ToolResponse {
  output: {
    data: AgentPhoneNumberMessage[]
    hasMore: boolean
  }
}

export interface AgentPhoneCreateCallParams {
  apiKey: string
  agentId: string
  toNumber: string
  fromNumberId?: string
  initialGreeting?: string
  voice?: string
  systemPrompt?: string
}

export interface AgentPhoneCreateCallResult extends ToolResponse {
  output: {
    id: string
    agentId: string | null
    status: string | null
    toNumber: string | null
    fromNumber: string | null
    phoneNumberId: string | null
    direction: string | null
    startedAt: string | null
  }
}

export interface AgentPhoneListCallsParams {
  apiKey: string
  limit?: number
  offset?: number
  status?: string
  direction?: string
  type?: string
  search?: string
}

export interface AgentPhoneListCallsResult extends ToolResponse {
  output: {
    data: AgentPhoneCallSummary[]
    hasMore: boolean
    total: number
  }
}

export interface AgentPhoneGetCallParams {
  apiKey: string
  callId: string
}

export interface AgentPhoneGetCallResult extends ToolResponse {
  output: AgentPhoneCallDetail
}

export interface AgentPhoneGetCallTranscriptParams {
  apiKey: string
  callId: string
}

export interface AgentPhoneGetCallTranscriptResult extends ToolResponse {
  output: {
    callId: string
    transcript: AgentPhoneTranscriptEntry[]
  }
}

export interface AgentPhoneListConversationsParams {
  apiKey: string
  limit?: number
  offset?: number
}

export interface AgentPhoneListConversationsResult extends ToolResponse {
  output: {
    data: AgentPhoneConversationSummary[]
    hasMore: boolean
    total: number
  }
}

export interface AgentPhoneGetConversationParams {
  apiKey: string
  conversationId: string
  messageLimit?: number
}

export interface AgentPhoneGetConversationResult extends ToolResponse {
  output: AgentPhoneConversationDetail
}

export interface AgentPhoneUpdateConversationParams {
  apiKey: string
  conversationId: string
  metadata?: Record<string, unknown> | null
}

export interface AgentPhoneUpdateConversationResult extends ToolResponse {
  output: AgentPhoneConversationDetail
}

export interface AgentPhoneGetConversationMessagesParams {
  apiKey: string
  conversationId: string
  limit?: number
  before?: string
  after?: string
}

export interface AgentPhoneGetConversationMessagesResult extends ToolResponse {
  output: {
    data: AgentPhoneConversationMessage[]
    hasMore: boolean
  }
}

export interface AgentPhoneSendMessageParams {
  apiKey: string
  agentId: string
  toNumber: string
  body: string
  mediaUrl?: string
  numberId?: string
}

export interface AgentPhoneSendMessageResult extends ToolResponse {
  output: {
    id: string
    status: string
    channel: string
    fromNumber: string
    toNumber: string
  }
}

export type AgentPhoneReactionType =
  | 'love'
  | 'like'
  | 'dislike'
  | 'laugh'
  | 'emphasize'
  | 'question'

export interface AgentPhoneReactToMessageParams {
  apiKey: string
  messageId: string
  reaction: AgentPhoneReactionType
}

export interface AgentPhoneReactToMessageResult extends ToolResponse {
  output: {
    id: string
    reactionType: string
    messageId: string
    channel: string
  }
}

export interface AgentPhoneCreateContactParams {
  apiKey: string
  phoneNumber: string
  name: string
  email?: string
  notes?: string
}

export interface AgentPhoneCreateContactResult extends ToolResponse {
  output: AgentPhoneContact
}

export interface AgentPhoneListContactsParams {
  apiKey: string
  search?: string
  limit?: number
  offset?: number
}

export interface AgentPhoneListContactsResult extends ToolResponse {
  output: {
    data: AgentPhoneContact[]
    hasMore: boolean
    total: number
  }
}

export interface AgentPhoneGetContactParams {
  apiKey: string
  contactId: string
}

export interface AgentPhoneGetContactResult extends ToolResponse {
  output: AgentPhoneContact
}

export interface AgentPhoneUpdateContactParams {
  apiKey: string
  contactId: string
  phoneNumber?: string
  name?: string
  email?: string
  notes?: string
}

export interface AgentPhoneUpdateContactResult extends ToolResponse {
  output: AgentPhoneContact
}

export interface AgentPhoneDeleteContactParams {
  apiKey: string
  contactId: string
}

export interface AgentPhoneDeleteContactResult extends ToolResponse {
  output: {
    id: string
    deleted: boolean
  }
}

export interface AgentPhoneUsagePlan {
  name: string
  limits: {
    numbers: number | null
    messagesPerMonth: number | null
    voiceMinutesPerMonth: number | null
    maxCallDurationMinutes: number | null
    concurrentCalls: number | null
  }
}

export interface AgentPhoneUsageStats {
  totalMessages: number | null
  messagesLast24h: number | null
  messagesLast7d: number | null
  messagesLast30d: number | null
  totalCalls: number | null
  callsLast24h: number | null
  callsLast7d: number | null
  callsLast30d: number | null
  totalWebhookDeliveries: number | null
  successfulWebhookDeliveries: number | null
  failedWebhookDeliveries: number | null
}

export interface AgentPhoneGetUsageParams {
  apiKey: string
}

export interface AgentPhoneGetUsageResult extends ToolResponse {
  output: {
    plan: AgentPhoneUsagePlan
    numbers: {
      used: number | null
      limit: number | null
      remaining: number | null
    }
    stats: AgentPhoneUsageStats
    periodStart: string
    periodEnd: string
  }
}

export interface AgentPhoneUsageDailyEntry {
  date: string
  messages: number
  calls: number
  webhooks: number
}

export interface AgentPhoneGetUsageDailyParams {
  apiKey: string
  days?: number
}

export interface AgentPhoneGetUsageDailyResult extends ToolResponse {
  output: {
    data: AgentPhoneUsageDailyEntry[]
    days: number
  }
}

export interface AgentPhoneUsageMonthlyEntry {
  month: string
  messages: number
  calls: number
  webhooks: number
}

export interface AgentPhoneGetUsageMonthlyParams {
  apiKey: string
  months?: number
}

export interface AgentPhoneGetUsageMonthlyResult extends ToolResponse {
  output: {
    data: AgentPhoneUsageMonthlyEntry[]
    months: number
  }
}
