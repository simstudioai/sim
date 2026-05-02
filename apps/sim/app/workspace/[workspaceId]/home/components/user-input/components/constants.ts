import { cn } from '@/lib/core/utils/cn'
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

export interface SpeechRecognitionStatic {
  new (): SpeechRecognitionInstance
}

export type WindowWithSpeech = Window & {
  SpeechRecognition?: SpeechRecognitionStatic
  webkitSpeechRecognition?: SpeechRecognitionStatic
}

export interface PlusMenuHandle {
  open: (anchor?: { left: number; top: number }, options?: { mention?: boolean }) => void
  close: () => void
  moveActive: (delta: number) => void
  selectActive: () => boolean
}

export const TEXTAREA_BASE_CLASSES = cn(
  'm-0 box-border h-auto min-h-[24px] w-full resize-none',
  'overflow-y-auto overflow-x-hidden break-words [overflow-wrap:anywhere] border-0 bg-transparent',
  'px-1 py-1 font-body text-[15px] leading-[24px] tracking-[-0.015em]',
  'text-transparent caret-[var(--text-primary)] outline-none',
  'placeholder:font-[380] placeholder:text-[var(--text-subtle)]',
  'focus-visible:ring-0 focus-visible:ring-offset-0',
  '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
)

export const OVERLAY_CLASSES = cn(
  'pointer-events-none absolute top-0 left-0 m-0 box-border h-auto w-full resize-none',
  'overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words [overflow-wrap:anywhere] border-0 bg-transparent',
  'px-1 py-1 font-body text-[15px] leading-[24px] tracking-[-0.015em]',
  'text-[var(--text-primary)] outline-none',
  '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
)

export const SEND_BUTTON_BASE = 'h-[28px] w-[28px] rounded-full border-0 p-0 transition-colors'
export const SEND_BUTTON_ACTIVE =
  'bg-[#383838] hover:bg-[#575757] dark:bg-[#E0E0E0] dark:hover:bg-[#CFCFCF]'
export const SEND_BUTTON_DISABLED = 'bg-[#808080] dark:bg-[#808080]'

export const MAX_CHAT_TEXTAREA_HEIGHT = 200
export const SPEECH_RECOGNITION_LANG = 'en-US'

export function autoResizeTextarea(e: React.FormEvent<HTMLTextAreaElement>, maxHeight: number) {
  const target = e.target as HTMLTextAreaElement
  target.style.height = 'auto'
  target.style.height = `${Math.min(target.scrollHeight, maxHeight)}px`
}

/**
 * Maps a {@link MothershipResource} (resource-picker domain) to a
 * {@link ChatContext} (chat-input domain). Keyed by `MothershipResourceType`
 * so adding a new resource type fails compilation here until a conversion is
 * supplied — preventing silent drift between the two taxonomies.
 */
const RESOURCE_TO_CONTEXT: Record<
  MothershipResourceType,
  (resource: MothershipResource) => ChatContext
> = {
  workflow: (r) => ({ kind: 'workflow', workflowId: r.id, label: r.title }),
  knowledgebase: (r) => ({ kind: 'knowledge', knowledgeId: r.id, label: r.title }),
  table: (r) => ({ kind: 'table', tableId: r.id, label: r.title }),
  file: (r) => ({ kind: 'file', fileId: r.id, label: r.title }),
  folder: (r) => ({ kind: 'folder', folderId: r.id, label: r.title }),
  task: (r) => ({ kind: 'past_chat', chatId: r.id, label: r.title }),
  log: (r) => ({ kind: 'logs', executionId: r.id, label: r.title }),
  generic: (r) => ({ kind: 'docs', label: r.title }),
}

export function mapResourceToContext(resource: MothershipResource): ChatContext {
  return RESOURCE_TO_CONTEXT[resource.type](resource)
}
