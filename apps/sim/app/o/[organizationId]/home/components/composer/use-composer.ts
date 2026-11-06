'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from '@sim/emcn'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { flushSync } from 'react-dom'
import { UNAVAILABLE_CONTEXT_NOTICE } from '@/lib/mothership/chat/context'
import { useOrganization } from '@/lib/organizations/provider'
import { usePromptEditor } from '@/app/workspace/[workspaceId]/home/components/user-input/components/prompt-editor'
import { organizationSkillOptions } from '@/app/workspace/[workspaceId]/home/components/user-input/components/skills-menu-dropdown/organization-skill-options'
import { usePromptHistory } from '@/app/workspace/[workspaceId]/home/components/user-input/hooks/use-prompt-history'
import type { ChatMessage, ChatRequestMode } from '@/app/workspace/[workspaceId]/home/types'
import type { useFileAttachments } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'
import { filterContextsPresentInMessage } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'
import { getSkillsQueryOptions } from '@/hooks/queries/skills'
import { fetchWorkspacesList, useWorkspacesQuery } from '@/hooks/queries/workspace'
import { useChatInputFocus } from '@/hooks/use-chat-input-focus'
import type {
  PendingComposerSubmission,
  useComposerSubmission,
} from '@/hooks/use-composer-submission'
import { useVoiceInput } from '@/hooks/use-voice-input'
import { readDraft, useMothershipDraftsStore } from '@/stores/mothership-drafts/store'
import type { ChatContext } from '@/stores/panel'

/** What a conversation hands whichever composer view its surface draws. */
export interface ConversationComposerProps {
  requestMode: ChatRequestMode
  onPlanChange?: () => void
  /** Where the draft lives: written to the first key, read through the rest. */
  draftKeys: readonly string[]
  files: ReturnType<typeof useFileAttachments>
  submission: ReturnType<typeof useComposerSubmission>
  /** On the empty home the placeholder types itself and the field is taller; in a chat it is the plain footer input. */
  isInitialView: boolean
  isSending: boolean
  restoredContexts: ChatContext[]
  onSubmit: (
    text: string,
    contexts?: ChatContext[]
  ) => undefined | false | PendingComposerSubmission
  onSendQueuedHead: () => void
  onEditQueuedTail: () => boolean
  messages: readonly ChatMessage[]
  onStop: () => void
}

interface UseComposerOptions extends ConversationComposerProps {
  /** The full page loads lists on intent and holds a `/name` until they land; the panel loads them on open and never holds. */
  waitsForFullLists: boolean
  /** Attachments the view shows itself, which count as something to send. */
  hasAdditionalAttachments?: boolean
}

/** A `/` starting a token: typed, pasted, or carried in by a draft, all of which skills can chip. */
const SLASH_TOKEN = /(^|\s)\//
/**
 * How long a send waits on the skill lists. The request layer sets no deadline, so this is the only
 * bound on a list that never lands, and the message waits in the field when it passes.
 */
const SKILL_LISTS_WAIT_MS = 10_000

/** A send waiting for the skill lists, so a `/name` in it is not sent as plain text. */
interface HeldSend {
  text: string
  /** Editing the text aborts this, ending the wait. */
  cancel: AbortController
}

function whenAborted(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

/**
 * The organization composer's behavior: editing, draft sync, voice, the skill lists, and submission.
 * Its two views draw it, the extension's panel and the page's. This module stays free of the design
 * system so the extension can bundle it.
 */
export function useComposer({
  requestMode,
  draftKeys,
  files,
  submission,
  isSending,
  restoredContexts,
  onSubmit,
  onSendQueuedHead,
  onEditQueuedTail,
  messages,
  waitsForFullLists,
  hasAdditionalAttachments = false,
}: UseComposerOptions) {
  const [draftKey] = draftKeys
  const value = useMothershipDraftsStore((state) => readDraft(state.drafts, draftKeys)?.text ?? '')
  const imagesOnly = requestMode === 'assistant'
  const { organization } = useOrganization()
  const queryClient = useQueryClient()
  const { data: allWorkspaces = [], isPending: workspacesPending } = useWorkspacesQuery(!imagesOnly)
  const waitsForLists = waitsForFullLists && !imagesOnly
  const workspaces = (imagesOnly ? [] : allWorkspaces).filter(
    (workspace) => workspace.organizationId === organization.id
  )
  // The field takes focus on load, so focus alone says nothing about wanting these per-workspace lists.
  const [resourceIntent, setResourceIntent] = useState(false)
  const [heldSend, setHeldSend] = useState<HeldSend | null>(null)
  /** The text the viewer was told would go out unchipped if they sent it again. */
  const [declinedWaitText, setDeclinedWaitText] = useState<string | null>(null)
  if (declinedWaitText !== null && value !== declinedWaitText) setDeclinedWaitText(null)
  const skillsWanted =
    !waitsForFullLists || resourceIntent || heldSend !== null || SLASH_TOKEN.test(value)
  const skillQueries = useQueries({
    queries: workspaces.map((workspace) => ({
      ...getSkillsQueryOptions(workspace.id),
      enabled: skillsWanted,
    })),
  })
  const skills = imagesOnly
    ? []
    : organizationSkillOptions(
        workspaces.map((workspace, index) => ({
          ...workspace,
          skills: skillQueries[index].isPlaceholderData ? [] : (skillQueries[index].data ?? []),
        }))
      )
  const skillListsPending =
    (waitsForLists && workspacesPending) || skillQueries.some((query) => query.isPending)
  const editor = usePromptEditor({
    workspaceId: '',
    availableSkills: skills,
    skillsLoading: waitsForFullLists && skillsWanted && skillListsPending,
    waitsForFullResources: waitsForLists,
    resourceIntent,
    onResourceIntent: () => setResourceIntent(true),
    organizationId: organization.id,
    contextsEnabled: !imagesOnly,
    initialValue: value,
    initialContexts: restoredContexts,
    onPasteFiles: files.processFiles,
  })
  const history = usePromptHistory({
    editor,
    attachedFiles: files.attachedFiles,
    restoreAttachedFiles: files.restoreAttachedFiles,
    getMessages: () => messages,
  })
  const { textareaRef, setValue, setContexts, getValue, getPlainValue, restorePrompt } = editor
  /**
   * The editor holds chips, the draft holds plain text, so neither can be the other's value. A write
   * from outside, a queued message restored or a chat cleared, reaches the editor here.
   */
  useEffect(() => {
    if (value === getPlainValue()) return
    setValue(value)
    if (value) textareaRef.current?.focus()
    else setContexts([])
  }, [value, textareaRef, setValue, setContexts, getPlainValue])
  useEffect(() => {
    if (getValue() !== editor.value) return
    const text = getPlainValue()
    const contexts = editor.contexts.length ? editor.contexts : undefined
    const store = useMothershipDraftsStore.getState()
    const saved = readDraft(store.drafts, draftKeys)
    if (text === (saved?.text ?? '') && contexts === saved?.contexts) return
    store.setDraft(draftKey, { ...store.drafts[draftKey], text, contexts })
  }, [editor.value, editor.contexts, draftKeys, draftKey, getValue, getPlainValue])
  useEffect(() => {
    history.reset()
    const { hasUnavailableContexts } = restorePrompt(getPlainValue(), restoredContexts)
    if (hasUnavailableContexts) toast.info(UNAVAILABLE_CONTEXT_NOTICE)
  }, [restoredContexts, history.reset, restorePrompt, getPlainValue])
  useChatInputFocus({ textareaRef })
  const voice = useVoiceInput({
    organizationId: organization.id,
    getValue: getPlainValue,
    onChange: (text) => setValue(text),
  })
  const hasPayload = (text: string, attached: typeof files.attachedFiles) =>
    text.trim().length > 0 || attached.some((file) => file.key) || hasAdditionalAttachments
  const canSubmit =
    !files.attachedFiles.some((file) => file.uploading) && hasPayload(value, files.attachedFiles)

  const { pending: preparingSubmission, accept: acceptSubmission } = submission
  const send = () => {
    const filesAtSend = files.getAttachedFiles()
    if (filesAtSend.some((file) => file.uploading)) return
    if (!hasPayload(getValue(), filesAtSend)) {
      if (isSending) onSendQueuedHead()
      return
    }
    const contexts = imagesOnly
      ? filterContextsPresentInMessage(
          editor.contexts.filter((context) => context.kind === 'browser_page'),
          getPlainValue()
        )
      : editor.getActiveContexts()
    const raw = getValue()
    acceptSubmission(
      () => onSubmit(getPlainValue(), contexts.length ? contexts : undefined),
      () => {
        voice.resetTranscript()
        history.reset()
        editor.clear()
      },
      () => getValue() === raw && files.getAttachedFiles() === filesAtSend,
      textareaRef.current
    )
  }

  /** A continuation resumes after renders it did not see, so it sends through the latest closure. */
  const sendRef = useRef(send)
  sendRef.current = send

  const settleSkillLists = async () => {
    const pendingIds = workspacesPending
      ? (await fetchWorkspacesList(queryClient))
          .filter((workspace) => workspace.organizationId === organization.id)
          .map((workspace) => workspace.id)
      : workspaces.flatMap((workspace, index) =>
          skillQueries[index].isPending ? [workspace.id] : []
        )
    const results = await Promise.allSettled(
      pendingIds.map((id) => queryClient.fetchQuery(getSkillsQueryOptions(id)))
    )
    return results.every((result) => result.status === 'fulfilled')
  }

  const holdSend = async (text: string) => {
    const cancel = new AbortController()
    setHeldSend({ text, cancel })
    const timeout = AbortSignal.timeout(SKILL_LISTS_WAIT_MS)
    const allLanded = await Promise.race([
      settleSkillLists().catch(() => false),
      whenAborted(timeout).then(() => false),
      whenAborted(cancel.signal).then(() => false),
    ])
    if (cancel.signal.aborted || !textareaRef.current || getPlainValue() !== text) return
    // Query observers notify on their own schedule. Render now, so the editor has the lists to chip with.
    flushSync(() => setHeldSend({ text, cancel }))
    flushSync(() => setValue(text))
    setHeldSend(null)
    if (!allLanded && SLASH_TOKEN.test(getValue())) {
      setDeclinedWaitText(text)
      toast.error(
        "Your skills didn't load, so this wasn't sent. Send again to send it as plain text."
      )
      return
    }
    sendRef.current()
  }

  const submit = () => {
    const text = getPlainValue()
    if (waitsForLists && skillListsPending && SLASH_TOKEN.test(text) && text !== declinedWaitText) {
      if (heldSend?.text !== text) void holdSend(text)
      return
    }
    send()
  }
  useEffect(() => {
    if (!heldSend || getPlainValue() === heldSend.text) return
    heldSend.cancel.abort()
    setHeldSend(null)
  }, [heldSend, editor.value, getPlainValue])

  const openResourceMenu = (event: { currentTarget: Element }) => {
    const rect = event.currentTarget.getBoundingClientRect()
    editor.openResourceMenu({ left: rect.left, top: rect.top })
  }
  const recallQueuedTail = () => {
    if (hasAdditionalAttachments || files.getAttachedFiles().length > 0) return false
    return onEditQueuedTail()
  }

  return {
    editor,
    voice,
    imagesOnly,
    value,
    canSend: canSubmit && !heldSend,
    submit,
    openResourceMenu,
    /** Enter and the arrow keys' policy, shared by the prompt editor and the plain Assistant field. */
    keyPolicy: {
      onNavigateHistory: hasAdditionalAttachments ? undefined : history.navigate,
      onArrowUpOnEmpty: recallQueuedTail,
    },
    frameProps: {
      'aria-busy': preparingSubmission || Boolean(heldSend) || undefined,
      inert: preparingSubmission,
      onDragEnter: files.handleDragEnter,
      onDragLeave: files.handleDragLeave,
      onDragOver: files.handleDragOver,
      onDrop: files.handleDrop,
    },
  }
}
