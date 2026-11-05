import type { DragEvent } from 'react'
import type { ChatContext, FileAttachmentForApi } from '@/platform/lib/data/chat-types'

export interface ChatAttachment {
  id: string
  name: string
  metadata: string
  kind: 'image' | 'document' | 'text' | 'reference'
  content?: string
  file?: File
  source?: string
  /** Still uploading; a draft holding one cannot be sent. */
  uploading?: boolean
  /** The context a reference attaches to the turn. */
  context?: ChatContext
  /** The stored upload a file attachment sends. */
  upload?: FileAttachmentForApi
}

export interface ComposerDraft {
  text: string
  attachments: ChatAttachment[]
}

export interface ChatTurn {
  id: string
  prompt: ComposerDraft
  sentAt: number
  timeZone?: string
  response?: {
    state: 'complete' | 'running' | 'failed' | 'stopped'
    duration: string
    thinking?: string
    progress?: string
    failure?: string
    paragraphs: { lead?: string; text: string }[]
    steps: {
      id: string
      name: string
      time: string
      input: string
      output: string
    }[]
    sentAt: number
  }
}

export type ComposerReferences = {
  group: string
  items: { id: string; name: string; context?: ChatContext }[]
}[]

interface ComposerChoice {
  id: string
  label: string
}

/** Model settings a draft sends with. Each part exists only when its gate is open. */
export interface ComposerSettings {
  effort?: { value: string; options: readonly ComposerChoice[]; onChange: (value: string) => void }
  model?: { value: string; options: readonly ComposerChoice[]; onChange: (value: string) => void }
  fastMode?: { enabled: boolean; onChange: (enabled: boolean) => void }
  plan?: { active: boolean; onChange: (active: boolean) => void }
}

/** The dragging state and handlers a composer's drop surface reads. */
interface ComposerDropHandlers {
  dragging: boolean
  onDragEnter: (event: DragEvent<HTMLElement>) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDragLeave: (event: DragEvent<HTMLElement>) => void
  onDrop: (event: DragEvent<HTMLElement>) => void
}

interface ComposerVoice {
  listening: boolean
  toggle: () => void
}

/**
 * The draft a message composer edits, with whatever backs it. A fixture session holds the draft in
 * memory; a live one uploads files and keeps the draft through a reload.
 */
export interface ComposerController {
  draft: ComposerDraft
  setText: (text: string) => void
  addFiles: (files: File[]) => void
  addPastedText: (text: string) => void
  removeAttachment: (id: string) => void
  addReference: (group: string, item: { id: string; name: string; context?: ChatContext }) => void
  clear: () => void
  references: ComposerReferences
  /** Reusable instructions the `/` menu lists, grouped like references. */
  skills?: readonly { id: string; name: string; context?: ChatContext }[]
  /** Tells the host a picker opened, which is when it reads the inventories behind them. */
  onPickerOpen?: () => void
  settings?: ComposerSettings
  drop?: ComposerDropHandlers
  voice?: ComposerVoice
  /** Whether Browser and Terminal can be attached in this host. */
  tools?: readonly { id: string; label: string; context?: ChatContext }[]
  /** A menu group with no rows is left out, rather than read as the viewer having none. */
  listsOnlyLoadedGroups?: boolean
  /** Accepted file types, when a mode narrows them. */
  accept?: string
}
