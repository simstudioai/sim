'use client'

import {
  createContext,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useContext,
  useLayoutEffect,
  useState,
} from 'react'
import { generateId } from '@sim/utils/id'
import { useRouter, useSearchParams } from 'next/navigation'
import type {
  ChatAttachment,
  ComposerController,
  ComposerDraft,
  ComposerInventory,
} from '@/app/(product)/_components/composer/model'
import { draftTitle, userTurn } from '@/app/(product)/_components/composer/user-turn'
import { useDesktopHost } from '@/app/(product)/_components/desktop/desktop-host'
import { useChatChanges } from '@/app/(product)/_components/session/chat-changes'
import { useComposerDraft } from '@/app/(product)/_components/session/composer-drafts'
import { useInterfacePreferences } from '@/app/(product)/_components/session/interface-preferences'
import { platformHref } from '@/platform/lib/navigation'

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
  useAppendHomePrompt: () => ((prompt: string) => void) | null
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

function useMemoryAppendHomePrompt() {
  const [, updateDraft] = useComposerDraft('home', { text: '', attachments: [] })
  return (prompt: string) =>
    updateDraft((draft) => ({
      ...draft,
      text: draft.text ? `${draft.text}\n\n${prompt}` : prompt,
    }))
}

const MEMORY_HOST: ComposerHost = {
  useComposer: useMemoryComposer,
  useStartChat: useMemoryStartChat,
  useStartSearch: () => null,
  useAppendHomePrompt: useMemoryAppendHomePrompt,
}

const HostContext = createContext<ComposerHost | null>(null)
const FocusContext = createContext<{
  target: string | null
  request: Dispatch<SetStateAction<string | null>>
} | null>(null)

interface ComposerSessionProps {
  children: ReactNode
}

/** Product sessions inherit their live host or own an in-memory fixture composer. */
export function ComposerSession({ children }: ComposerSessionProps) {
  const host = useContext(HostContext) ?? MEMORY_HOST
  const [target, request] = useState<string | null>(null)
  return (
    <HostContext.Provider value={host}>
      <FocusContext.Provider value={{ target, request }}>{children}</FocusContext.Provider>
    </HostContext.Provider>
  )
}

/** Complete a cross-page prompt handoff when its composer is mounted. */
export function useComposerFocus(
  key: string | undefined,
  input: RefObject<HTMLTextAreaElement | null>
) {
  const focus = useContext(FocusContext)
  const target = focus?.target
  const request = focus?.request
  useLayoutEffect(() => {
    if (!key || target !== key || !input.current) return
    const field = input.current
    field.focus({ preventScroll: true })
    field.setSelectionRange(field.value.length, field.value.length)
    field.scrollIntoView({ block: 'nearest' })
    request?.(null)
  }, [key, target, request, input])
}

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
  return useContext(HostContext) ?? MEMORY_HOST
}

function useUnavailableHomePrompt() {
  return null
}

/** Prepare an editable Home draft without sending it or replacing existing work. */
export function useHomePrompt() {
  const useAppendPrompt = useContext(HostContext)?.useAppendHomePrompt ?? useUnavailableHomePrompt
  const append = useAppendPrompt()
  const preferences = useInterfacePreferences()
  const focus = useContext(FocusContext)
  const router = useRouter()
  const search = useSearchParams()
  if (!append) return null
  return (prompt: string) => {
    append(prompt)
    preferences?.setHomeMode('Build')
    focus?.request('home')
    router.push(platformHref('/home', search))
  }
}
