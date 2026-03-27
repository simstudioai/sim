type LegacyStreamEventType =
  | 'chat_id'
  | 'request_id'
  | 'title_updated'
  | 'content'
  | 'reasoning'
  | 'tool_call'
  | 'tool_call_delta'
  | 'tool_generating'
  | 'tool_result'
  | 'tool_error'
  | 'resource_added'
  | 'resource_deleted'
  | 'subagent_start'
  | 'subagent_end'
  | 'structured_result'
  | 'subagent_result'
  | 'context_compaction_start'
  | 'context_compaction'
  | 'done'
  | 'error'
  | 'start'

export interface LegacyStreamEvent {
  type: LegacyStreamEventType
  state?: string
  data?: Record<string, unknown>
  agent?: string
  subagent?: string
  toolCallId?: string
  toolName?: string
  success?: boolean
  result?: unknown
  chatId?: string
  title?: string
  error?: string
  content?: string
  phase?: string
  ui?: Record<string, unknown>
  resource?: { type: string; id: string; title: string }
}
