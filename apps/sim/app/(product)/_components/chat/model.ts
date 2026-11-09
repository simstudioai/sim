import type { ComposerDraft } from '@/app/(product)/_components/composer/model'
import type {
  CredentialItemData,
  SearchConnectionTarget,
  SearchResource,
} from '@/platform/lib/data/chat-types'

/** Every state a tool call can be in. Waiting on a person and each way of not finishing stay apart. */
export type PlatformToolStatus =
  | 'executing'
  | 'awaiting_approval'
  | 'success'
  | 'error'
  | 'cancelled'
  | 'skipped'
  | 'rejected'
  | 'interrupted'

export interface PlatformTool {
  id: string
  name: string
  title: string
  status: PlatformToolStatus
  /** Elapsed or relative label for the row's trailing slot, when the source has one. */
  time?: string
  input?: string
  output?: string
  error?: string
  /** The call goes through Assistant review rather than the tool-permission prompt. */
  reviewed?: boolean
  /** A terminal paused for the person at the keyboard. */
  handoff?: { terminalId: string; reason: string }
}

export type PlatformLaneItem =
  | { kind: 'text'; id: string; segments: readonly PlatformSegment[] }
  | { kind: 'tool'; tool: PlatformTool }
  | { kind: 'lane'; lane: PlatformLane }

/** One subagent's work. Lanes nest and may run alongside each other. */
export interface PlatformLane {
  id: string
  label: string
  /** The live description of what the lane is doing, or a summary once it has finished. */
  status: string
  running: boolean
  error?: string
  items: readonly PlatformLaneItem[]
}

export interface PlatformQuestion {
  prompt: string
  type: 'single_select' | 'multi_select'
  options: readonly { id: string; label: string; description?: string }[]
}

export interface PlatformCredentialRequest {
  type: string
  name?: string
  provider?: string
  value?: string
  description?: string
  scope?: string
  workspaceId?: string
  /** The parsed tag item this row came from, which the submission message is built from. */
  source: CredentialItemData
  /** The connect link, present only when it is safe to open as http(s). */
  safeUrl?: string
  /** Present when this row connects a Search source rather than a workspace credential. */
  searchTarget?: SearchConnectionTarget
}

/** The structured pieces of assistant prose, in the order the model wrote them. */
export type PlatformSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'options'; options: readonly { id: string; label: string; description?: string }[] }
  | { kind: 'question'; questions: readonly PlatformQuestion[]; answers?: readonly string[] }
  | {
      kind: 'credential'
      items: readonly PlatformCredentialRequest[]
      submission?: PlatformCredentialSubmission
      abandoned?: boolean
    }
  | { kind: 'resource'; type: string; id: string; title: string; workspaceId?: string }
  | { kind: 'usage'; action: string; reason: string; message: string }
  | { kind: 'failure'; message: string }
  | { kind: 'pending'; label: string }

export interface PlatformCredentialSubmission {
  saved: readonly string[]
  skipped: readonly string[]
}

export type PlatformPart =
  | {
      kind: 'prose'
      id: string
      /** Plain fixture paragraphs; live data uses `segments`. */
      paragraphs?: readonly { lead?: string; text: string }[]
      segments?: readonly PlatformSegment[]
    }
  | {
      kind: 'activity'
      id: string
      label: string
      initiallyOpen: boolean
      thinking?: string
      progress?: string
      tools: readonly PlatformTool[]
    }
  | { kind: 'approval'; id: string; tool: PlatformTool }
  | { kind: 'lane'; id: string; lane: PlatformLane }
  | { kind: 'task'; id: string; title: string }
  | { kind: 'stopped'; id: string }

type PlatformTurnState = 'complete' | 'running' | 'failed' | 'stopped'

export type PlatformTurn =
  | {
      role: 'user'
      id: string
      prompt: ComposerDraft
      sentAt?: number
      timeZone?: string
      /** Where a message this client is still delivering stands; absent once delivered. */
      delivery?: 'sending' | 'waiting' | 'failed'
    }
  | {
      /** A turn automation opened. The person did not type it, so it is never their bubble. */
      role: 'automated'
      id: string
      label: string
      summary: string
    }
  | {
      role: 'assistant'
      id: string
      state: PlatformTurnState
      parts: readonly PlatformPart[]
      /** Markdown a reader gets from Copy. */
      copyText: string
      sentAt?: number
      /** The wait wording while nothing is arriving, such as Thinking. */
      waiting?: string
      failure?: string
      requestId?: string
      /** The message before this one, the query a rating refers to. */
      userQuery?: string
      /** The final question or credential card replaces the actions until it settles. */
      endsWithInteraction?: boolean
      /** A persisted id, so the turn can be forked from. */
      forkable?: boolean
    }

type ChatRuntimeStatus = 'idle' | 'loading' | 'sending' | 'reconnecting'

export type ToolDecision = 'allow' | 'allow_chat' | 'always_allow' | 'skip'

export interface PlatformResource {
  id: string
  type: string
  title: string
  workspaceId?: string
  /** A legacy URL for a kind the Platform does not render in the panel. */
  href?: string
  active?: boolean
  /** The retrieval a Search tab holds; runs under the current reader's permissions. */
  search?: SearchResource
}

/** Cross-turn tool-permission progress, so only one card offers the bulk action. */
interface ToolApprovalProgress {
  outstanding: readonly string[]
  submitted: readonly string[]
}

interface AssistantReviewField {
  name: string
  label: string
  value: string
  editable: boolean
  multiline: boolean
}

export interface AssistantReviewAction {
  /** The tool call that proposed it. */
  id: string
  title: string
  account?: { name: string; active: boolean }
  fields: readonly AssistantReviewField[]
}

export interface AssistantReceipt {
  id: string
  title: string
  state: string
  stateLabel: string
  detail?: string
  warning?: string
}

/**
 * Everything a conversation surface needs from a chat. A live chat drives the existing chat hook;
 * a fixture session answers from memory. Neither view code nor the fixture knows which it has.
 */
export interface ChatRuntime {
  chatId?: string
  title: string
  status: ChatRuntimeStatus
  /** Set when no history could load; distinct from an empty new chat. */
  loadFailed?: boolean
  turns: readonly PlatformTurn[]
  /** False keeps the draft: nothing was sent. A send while a turn runs steers that turn. */
  send: (draft: ComposerDraft) => false | undefined
  stop: () => void
  /** Sends the message as written by the user, for question answers and option picks. */
  sendText: (text: string) => void
  /** Runs a failed turn again. Absent when this chat has no failed-turn state to recover. */
  retry?: (turnId: string) => void
  /** Tries again to deliver a message shown as not delivered. */
  retryMessage?: (messageId: string) => void
  dismissMessage?: (messageId: string) => void
  approvals: ToolApprovalProgress
  registerApproval: (toolCallId: string) => () => void
  decideTools: (ids: readonly string[], decision: ToolDecision) => Promise<'ok' | 'gone'>
  /** Actions in review for this chat, keyed by the tool call that proposed them. */
  review?: {
    /** The latest assistant turn in this chat, which the pending actions belong to. */
    turnId?: string
    status: 'loading' | 'ready' | 'error'
    actions: readonly AssistantReviewAction[]
    receipts: readonly AssistantReceipt[]
    pending: boolean
    retry: () => void
    decide: (
      actionIds: readonly string[],
      decision: 'allow' | 'skip',
      edits?: Record<string, Record<string, string>>
    ) => Promise<void>
  }
  rate?: (input: {
    query: string
    response: string
    positive: boolean
    details: string
  }) => Promise<void>
  fork?: (turnId: string) => Promise<void>
  openResource?: (ref: { type: string; id: string; title: string; workspaceId?: string }) => void
  /** Returns the terminal to Sim after a handoff. Absent outside the desktop host. */
  finishTerminalHandoff?: (terminalId: string) => void
}
