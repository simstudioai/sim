import { cn } from '@sim/emcn'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import type { ChatContext } from '@/stores/panel'

export interface SpeechRecognitionEvent extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}

export interface SpeechRecognitionErrorEvent extends Event {
  error: string
}

export interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort(): void
  onstart: ((ev: Event) => void) | null
  onend: ((ev: Event) => void) | null
  onresult: ((ev: SpeechRecognitionEvent) => void) | null
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null
}

interface SpeechRecognitionStatic {
  new (): SpeechRecognitionInstance
}

export type WindowWithSpeech = Window & {
  SpeechRecognition?: SpeechRecognitionStatic
  webkitSpeechRecognition?: SpeechRecognitionStatic
}

export interface PlusMenuHandle {
  /** Opens the menu anchored at a viewport position (caret or trigger rect). */
  open: (anchor: { left: number; top: number }, options?: { mention?: boolean }) => void
  close: () => void
  moveActive: (delta: number) => void
  /**
   * Confirms the highlighted candidate.
   *
   * - `selected` — a candidate was inserted.
   * - `empty` — the lists are loaded and nothing matches, so the caller should
   *   let the key through (Enter submits, Tab does its default).
   * - `hydrating` — the lists are still loading, so "nothing matches" is not yet
   *   knowable. The caller must swallow the key rather than submit a message
   *   with the mention left as raw text.
   */
  selectActive: () => 'selected' | 'empty' | 'hydrating'
}

/**
 * Box and typography shared by the textarea and its mirror overlay — both must
 * produce identical line wrapping so the overlay text sits exactly over the
 * (transparent) textarea text. The scale is the chat input's native prompt
 * scale (`text-[14px]`, `-0.015em` tracking); the task modal's body inherits it
 * so the editor reads the same whether it's the chat input or inside the modal.
 */
const FIELD_MIRROR_CLASSES = cn(
  'm-0 box-border min-h-[24px] w-full [overflow-wrap:anywhere] border-0 bg-transparent',
  'px-1 py-1 font-body text-[14px] leading-[24px] tracking-[-0.015em]'
)

/**
 * The textarea grows to its full content height (`h-auto`, no internal scroll);
 * the shared scroller clips and scrolls it. Its text is transparent so the
 * mirror overlay shows through; only the caret paints.
 */
export const TEXTAREA_BASE_CLASSES = cn(
  FIELD_MIRROR_CLASSES,
  'block h-auto resize-none overflow-hidden',
  'text-transparent caret-[var(--text-primary)] outline-hidden',
  'placeholder:text-[var(--text-muted)]',
  'focus-visible:ring-0 focus-visible:ring-offset-0'
)

/**
 * Pinned over the full-height textarea (`inset-0` of the sizer). Both are flow
 * children of the same scroller, so they scroll together natively — no JS
 * scroll-sync, so the caret and mirrored text never drift apart.
 */
export const OVERLAY_CLASSES = cn(
  FIELD_MIRROR_CLASSES,
  'pointer-events-none absolute inset-0 whitespace-pre-wrap',
  'text-[var(--text-primary)]'
)

/** Single scroll container for the textarea + overlay; caps height and hides its scrollbar. */
export const SCROLLER_CLASSES = cn(
  'relative overflow-y-auto overflow-x-hidden',
  '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
)

export const SEND_BUTTON_BASE = 'h-[28px] w-[28px] rounded-full border-0 p-0 transition-colors'
export const SEND_BUTTON_ACTIVE =
  'bg-[#383838] hover:bg-[#575757] dark:bg-[#E0E0E0] dark:hover:bg-[#CFCFCF]'
export const SEND_BUTTON_DISABLED = 'bg-[#808080] dark:bg-[#808080]'

export const SPEECH_RECOGNITION_LANG = 'en-US'

/**
 * Maps a {@link MothershipResource} (resource-picker domain) to a
 * {@link ChatContext} (chat-input domain). Keyed by `MothershipResourceType`
 * so adding a new resource type fails compilation here until a conversion is
 * supplied — preventing silent drift between the two taxonomies.
 */
// Browser/terminal resources may name either the singleton panel or one live
// inner tab. The singleton ids ask the agent to inspect the whole resource;
// every other id is a precise live-tab pointer.
const RESOURCE_TO_CONTEXT: Record<
  MothershipResourceType,
  (resource: MothershipResource) => ChatContext
> = {
  browser: (r) => ({ kind: 'browser_tab', tabId: r.id, label: r.title }),
  terminal: (r) => ({ kind: 'terminal_tab', terminalId: r.id, label: r.title }),
  workflow: (r) => ({ kind: 'workflow', workflowId: r.id, label: r.title }),
  knowledgebase: (r) => ({ kind: 'knowledge', knowledgeId: r.id, label: r.title }),
  table: (r) => ({ kind: 'table', tableId: r.id, label: r.title }),
  file: (r) => ({ kind: 'file', fileId: r.id, label: r.title }),
  folder: (r) => ({ kind: 'folder', folderId: r.id, label: r.title }),
  filefolder: (r) => ({ kind: 'filefolder', fileFolderId: r.id, label: r.title }),
  task: (r) => ({ kind: 'past_chat', chatId: r.id, label: r.title }),
  // Addressed by run, not by log row: `id` is the row's key, and the server
  // resolves this context against `workflow_execution_logs.execution_id`. A
  // picked resource carries the run id; one rebuilt from the wire (a restored
  // or agent-opened tab) cannot, since the stored and streamed resource shapes
  // are the identity triple — those keep the row id they have always sent.
  log: (r) => ({ kind: 'logs', executionId: r.executionId ?? r.id, label: r.title }),
  integration: (r) => ({ kind: 'integration', blockType: r.id, label: r.title }),
  generic: (r) => ({ kind: 'docs', label: r.title }),
}

export function mapResourceToContext(resource: MothershipResource): ChatContext {
  return RESOURCE_TO_CONTEXT[resource.type](resource)
}
