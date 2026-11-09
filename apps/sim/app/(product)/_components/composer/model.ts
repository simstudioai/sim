import type { DragEvent } from 'react'
import type { IconName } from '@sim/emcn/catalog/icon-geometry'
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
  referenceId?: string
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

export interface ComposerReference {
  id: string
  name: string
  context?: ChatContext
  icon?: IconName
  providerId?: string
  detail?: string
  workspaceId?: string
  workspaceName?: string
  parentId?: string
  /** Resource family whose browse tree contains this selectable folder. */
  folderFor?: string
  skillKind?: 'mcp'
  /** A family name an `@` query also matches, for rows named after something else. */
  family?: string
  /**
   * The query this row is the server's ranked match for (by name, word or folder path). It stays
   * listed for that query rather than being filtered again by its name.
   */
  matchedQuery?: string
}

type ComposerReferences = {
  group: string
  items: ComposerReference[]
}[]

export interface ComposerInventory {
  references: ComposerReferences
  skills?: readonly ComposerReference[]
  /** Open desktop pages and shells offered as context. */
  tools?: readonly { id: string; label: string; context?: ChatContext }[]
}

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
export interface ComposerController extends ComposerInventory {
  draft: ComposerDraft
  setText: (
    text: string,
    changes?: {
      add?: readonly (ComposerReference & { group: string })[]
      remove?: readonly string[]
    }
  ) => void
  addFiles: (files: File[]) => void
  addPastedText: (text: string) => void
  removeAttachment: (id: string) => void
  clear: () => void
  /** Replaces the draft with a message sent earlier, for prompt recall. */
  restore: (draft: ComposerDraft) => void
  referencesDisabled?: boolean
  referencesLoading?: boolean
  skillsLoading?: boolean
  /** Tells the host a picker opened, which is when it reads the inventories behind them. */
  onPickerOpen?: () => void
  /** What follows an `@` as it is typed, which the host searches by. */
  onReferenceSearch?: (query: string) => void
  /** What the resource menu lists: workspaces, each opened workspace's families, or its search's matches. */
  browse: ComposerReferences
  /** A workspace opened in the resource menu, whose families the host then reads. */
  onBrowseWorkspace?: (workspaceId: string) => void
  /** The resource menu's search, which the host answers. */
  onBrowseSearch?: (query: string) => void
  settings?: ComposerSettings
  drop?: ComposerDropHandlers
  voice?: ComposerVoice
  /** Accepted file types, when a mode narrows them. */
  accept?: string
}
