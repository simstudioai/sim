import type { ComposerDraft } from '@/app/(product)/_components/composer/model'
import type { SourceRowData } from '@/app/(product)/_components/source-row/source-row'
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
      /** The documents its answer cites, once each in first-cited order; lane work cites none. */
      sources?: readonly ChatSource[]
    }

/** A document an answer cites, in the row shape Search results share. */
export type ChatSource = SourceRowData

type ChatRuntimeStatus = 'idle' | 'loading' | 'sending' | 'reconnecting'

export type ToolDecision = 'allow' | 'allow_chat' | 'always_allow' | 'skip'

export interface PlatformResource {
  id: string
  type: string
  title: string
  workspaceId?: string
  /** Where the resource opens in its workspace, or beside the organization's Home. */
  href?: string
  /** A log addressed by its run before the log row's id is known. */
  executionId?: string
  active?: boolean
  /** The retrieval a Search tab holds; runs under the current reader's permissions. */
  search?: SearchResource
  /** What a Sources tab lists: the documents one answer cited. */
  sources?: readonly ChatSource[]
}

/** Cross-turn tool-permission progress, so only one card offers the bulk action. */
interface ToolApprovalProgress {
  outstanding: readonly string[]
  submitted: readonly string[]
}

/** A reviewed field as shown: readable label and value, and whether the reader may change it. */
export interface AssistantReviewField {
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

/** What one reviewed action did, and the fields it ran with while they are still kept. */
export interface AssistantReceipt {
  id: string
  title: string
  state: string
  stateLabel: string
  /** The action's leading field, shown while the receipt is closed. */
  summary?: string
  warning?: string
  account?: string
  /** Absent once the details are no longer available. */
  fields?: readonly AssistantReviewField[]
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
    /** The assistant turn the pending actions belong to. */
    turnId?: string
    chatId?: string
    /** A turn is streaming, so the current turn's receipts poll. */
    active: boolean
    /** The stream each assistant turn ran on, which names that turn's receipts. */
    streamIds: ReadonlyMap<string, string>
    /** Each assistant turn's tool calls whose receipts are read by id when no page covers them. */
    candidates: ReadonlyMap<string, readonly string[]>
    status: 'loading' | 'ready' | 'error'
    actions: readonly AssistantReviewAction[]
    /** More actions wait behind this batch. */
    more: boolean
    pending: boolean
    retry: () => void
    /** Resolves to the failure message of each action that could not be saved. */
    decide: (
      actionIds: readonly string[],
      decision: 'allow' | 'skip',
      edits?: Record<string, Record<string, string>>
    ) => Promise<Record<string, string>>
  }
  rate?: (input: {
    query: string
    response: string
    positive: boolean
    details: string
  }) => Promise<void>
  fork?: (turnId: string) => Promise<void>
  openResource?: (ref: { type: string; id: string; title: string; workspaceId?: string }) => void
  /** Opens every source an answer cited in the panel. */
  viewSources?: (turnId: string, requestId?: string) => void
  /** Returns the terminal to Sim after a handoff. Absent outside the desktop host. */
  finishTerminalHandoff?: (terminalId: string) => void
}
