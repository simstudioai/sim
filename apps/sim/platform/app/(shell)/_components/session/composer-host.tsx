'use client'

import { createContext, type ReactNode, useContext } from 'react'
import { generateId } from '@sim/utils/id'
import { useRouter, useSearchParams } from 'next/navigation'
import type {
  ChatAttachment,
  ComposerController,
  ComposerDraft,
  ComposerInventory,
} from '@/platform/app/(shell)/_components/composer/model'
import { draftTitle, userTurn } from '@/platform/app/(shell)/_components/composer/user-turn'
import { useDesktopHost } from '@/platform/app/(shell)/_components/desktop/desktop-host'
import { useChatChanges } from '@/platform/app/(shell)/_components/session/chat-changes'
import { useComposerDraft } from '@/platform/app/(shell)/_components/session/composer-drafts'
import { platformHref } from '@/platform/design-system/navigation'

export interface ComposerOptions extends Partial<ComposerInventory> {
  draftKey: string
  /** Assistant mode accepts images instead of workspace references. */
  requestMode?: 'agent' | 'assistant' | 'plan'
  chatId?: string
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
  skills,
  tools,
  requestMode,
  initialAttachments = [],
}: ComposerOptions): ComposerController {
  const desktop = useDesktopHost()
  const [draft, updateDraft] = useComposerDraft(draftKey, {
    text: '',
    attachments: initialAttachments,
  })
  return {
    draft,
    references,
    skills,
    tools: desktop ? tools : undefined,
    referencesDisabled: requestMode === 'assistant',
    setText: (text, changes) =>
      updateDraft((current) => {
        if (!changes?.add?.length && !changes?.remove?.length) return { ...current, text }
        const removed = new Set(changes.remove)
        const added: ChatAttachment[] = (changes.add ?? []).map((item) => ({
          id: generateId(),
          referenceId: item.id,
          kind: 'reference',
          name: item.name,
          metadata: item.group,
        }))
        return {
          text,
          attachments: [...current.attachments.filter((item) => !removed.has(item.id)), ...added],
        }
      }),
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
    clear: () => updateDraft(() => ({ text: '', attachments: [] })),
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
