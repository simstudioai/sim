import { cn } from '@/lib/core/utils/cn'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'
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
  open: (anchor?: { left: number; top: number }) => void
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

export function mapResourceToContext(resource: MothershipResource): ChatContext {
  switch (resource.type) {
    case 'workflow':
      return {
        kind: 'workflow',
        workflowId: resource.id,
        label: resource.title,
      }
    case 'knowledgebase':
      return {
        kind: 'knowledge',
        knowledgeId: resource.id,
        label: resource.title,
      }
    case 'table':
      return { kind: 'table', tableId: resource.id, label: resource.title }
    case 'file':
      return { kind: 'file', fileId: resource.id, label: resource.title }
    default:
      return { kind: 'docs', label: resource.title }
  }
}
