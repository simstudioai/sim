'use client'

import { createContext, type ReactNode, useContext } from 'react'
import { generateId } from '@sim/utils/id'
import { useRouter, useSearchParams } from 'next/navigation'
import type {
  ChatAttachment,
  ComposerController,
  ComposerDraft,
  ComposerReferences,
} from '@/platform/app/(shell)/_components/composer/model'
import { draftTitle, userTurn } from '@/platform/app/(shell)/_components/composer/user-turn'
import { useChatChanges } from '@/platform/app/(shell)/_components/session/chat-changes'
import { useComposerDraft } from '@/platform/app/(shell)/_components/session/composer-drafts'
import { platformHref } from '@/platform/design-system/navigation'

export interface ComposerOptions {
  draftKey: string
  /** Agent, assistant or plan; a fixture session ignores it. */
  requestMode?: 'agent' | 'assistant' | 'plan'
  chatId?: string
  references?: ComposerReferences
  initialAttachments?: ChatAttachment[]
}

/**
 * What the shell can start from outside a conversation. A hook pair so Home and Chat read one
 * composer whichever session they are in; a session never changes kind while mounted.
 */
export interface ComposerHost {
  useComposer: (options: ComposerOptions) => ComposerController
  /** Starts a chat from Home's composer and enters it. */
  useStartChat: () => (draft: ComposerDraft) => undefined | false
  /** Opens Search with a query, where Home's Search segment leads; null when the viewer can't. */
  useStartSearch: () => ((query: string) => void) | null
}

function attachmentFor(file: File): ChatAttachment {
  const image = file.type.startsWith('image/')
  const text = file.type.startsWith('text/')
  return {
    id: generateId(),
    name: file.name,
    kind: image ? 'image' : text ? 'text' : 'document',
    metadata: file.type || 'File',
    file,
  }
}

function useMemoryComposer({
  draftKey,
  references = [],
  initialAttachments = [],
}: ComposerOptions): ComposerController {
  const [draft, updateDraft] = useComposerDraft(draftKey, {
    text: '',
    attachments: initialAttachments,
  })
  return {
    draft,
    references,
    setText: (text) => updateDraft((current) => ({ ...current, text })),
    addFiles: (files) => {
      const added = files.map(attachmentFor)
      updateDraft((current) => ({ ...current, attachments: [...current.attachments, ...added] }))
    },
    addPastedText: (value) => {
      const pasted: ChatAttachment = {
        id: generateId(),
        kind: 'text',
        name: 'Pasted text',
        metadata: `${value.length.toLocaleString()} characters`,
        content: value,
      }
      updateDraft((current) => ({ ...current, attachments: [...current.attachments, pasted] }))
    },
    removeAttachment: (id) =>
      updateDraft((current) => ({
        ...current,
        attachments: current.attachments.filter((file) => file.id !== id),
      })),
    addReference: (group, item) => {
      const reference: ChatAttachment = {
        id: generateId(),
        kind: 'reference',
        name: item.name,
        metadata: group,
      }
      updateDraft((current) => ({
        text: current.text === '/' ? '' : current.text,
        attachments: [...current.attachments, reference],
      }))
    },
    clear: () => updateDraft(() => ({ text: '', attachments: [] })),
    tools: [
      { id: 'browser', label: 'Browser' },
      { id: 'terminal', label: 'Terminal' },
    ],
  }
}

function useMemoryStartChat() {
  const router = useRouter()
  const search = useSearchParams()
  const { createChat } = useChatChanges()
  return (draft: ComposerDraft): undefined => {
    const id = createChat(draftTitle(draft), [userTurn(draft)])
    router.push(platformHref(`/chat/${id}`, search))
  }
}

const MEMORY_HOST: ComposerHost = {
  useComposer: useMemoryComposer,
  useStartChat: useMemoryStartChat,
  useStartSearch: () => null,
}

const HostContext = createContext<ComposerHost>(MEMORY_HOST)

export function ComposerHostProvider({
  host,
  children,
}: {
  host: ComposerHost
  children: ReactNode
}) {
  return <HostContext.Provider value={host}>{children}</HostContext.Provider>
}

export function useComposerHost(): ComposerHost {
  return useContext(HostContext)
}
