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
  selectActive: () => boolean
}

/**
 * Box and typography shared by the textarea and its mirror overlay — both must
 * produce identical line wrapping so the overlay text sits exactly over the
 * (transparent) textarea text. The scale is the chat input's native prompt
 * scale (`text-[15px]`, `-0.015em` tracking); the task modal's body inherits it
 * so the editor reads the same whether it's the chat input or inside the modal.
 */
const FIELD_MIRROR_CLASSES = cn(
  'm-0 box-border min-h-[24px] w-full break-words [overflow-wrap:anywhere] border-0 bg-transparent',
  'px-1 py-1 font-body text-[15px] leading-[24px] tracking-[-0.015em]'
)

/**
 * The textarea grows to its full content height (`h-auto`, no internal scroll);
 * the shared scroller clips and scrolls it. Its text is transparent so the
 * mirror overlay shows through; only the caret paints.
 */
export const TEXTAREA_BASE_CLASSES = cn(
  FIELD_MIRROR_CLASSES,
  'block h-auto resize-none overflow-hidden',
  'text-transparent caret-[var(--text-primary)] outline-none',
  'placeholder:font-[380] placeholder:text-[var(--text-subtle)]',
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
const RESOURCE_TO_CONTEXT: Record<
  Exclude<MothershipResourceType, 'browser'>,
  (resource: MothershipResource) => ChatContext
> = {
  workflow: (r) => ({ kind: 'workflow', workflowId: r.id, label: r.title }),
  knowledgebase: (r) => ({ kind: 'knowledge', knowledgeId: r.id, label: r.title }),
  table: (r) => ({ kind: 'table', tableId: r.id, label: r.title }),
  file: (r) => ({ kind: 'file', fileId: r.id, label: r.title }),
  folder: (r) => ({ kind: 'folder', folderId: r.id, label: r.title }),
  filefolder: (r) => ({ kind: 'filefolder', fileFolderId: r.id, label: r.title }),
  task: (r) => ({ kind: 'past_chat', chatId: r.id, label: r.title }),
  log: (r) => ({ kind: 'logs', executionId: r.id, label: r.title }),
  integration: (r) => ({ kind: 'integration', blockType: r.id, label: r.title }),
  scheduledtask: (r) => ({ kind: 'scheduledtask', scheduleId: r.id, label: r.title }),
  generic: (r) => ({ kind: 'docs', label: r.title }),
}

export function mapResourceToContext(resource: MothershipResource): ChatContext {
  if (resource.type === 'browser') {
    throw new Error('Live browser sessions cannot be attached as chat context')
  }
  return RESOURCE_TO_CONTEXT[resource.type](resource)
}
