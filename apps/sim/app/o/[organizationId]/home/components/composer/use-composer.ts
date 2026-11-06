'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from '@sim/emcn'
import { useQueries } from '@tanstack/react-query'
import { UNAVAILABLE_CONTEXT_NOTICE } from '@/lib/mothership/chat/context'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { usePromptEditor } from '@/app/workspace/[workspaceId]/home/components/user-input/components/prompt-editor'
import { organizationSkillOptions } from '@/app/workspace/[workspaceId]/home/components/user-input/components/skills-menu-dropdown/organization-skill-options'
import { usePromptHistory } from '@/app/workspace/[workspaceId]/home/components/user-input/hooks/use-prompt-history'
import type { ChatMessage, ChatRequestMode } from '@/app/workspace/[workspaceId]/home/types'
import type { useFileAttachments } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'
import { filterContextsPresentInMessage } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'
import { getSkillsQueryOptions } from '@/hooks/queries/skills'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'
import { useChatInputFocus } from '@/hooks/use-chat-input-focus'
import type {
  PendingComposerSubmission,
  useComposerSubmission,
} from '@/hooks/use-composer-submission'
import { useVoiceInput } from '@/hooks/use-voice-input'
import type { ChatContext } from '@/stores/panel'

/** What a conversation hands whichever composer view its surface draws. */
export interface ConversationComposerProps {
  requestMode: ChatRequestMode
  onPlanChange?: () => void
  value: string
  files: ReturnType<typeof useFileAttachments>
  submission: ReturnType<typeof useComposerSubmission>
  /** On the empty home the placeholder types itself and the field is taller; in a chat it is the plain footer input. */
  isInitialView: boolean
  isSending: boolean
  onChange: (value: string, contexts?: ChatContext[]) => void
  restoredContexts?: ChatContext[]
  onSubmit: (
    text: string,
    contexts?: ChatContext[]
  ) => undefined | false | PendingComposerSubmission
  onSendQueuedHead?: () => void
  onEditQueuedTail?: () => boolean
  messages?: readonly ChatMessage[]
  onStop: () => void
}

interface UseComposerOptions extends ConversationComposerProps {
  /** The full page waits for complete lists before it sends a `/name`; the panel keeps its own timing. */
  waitsForFullLists: boolean
  /** Attachments the view shows itself, which count as something to send. */
  hasAdditionalAttachments: boolean
}

/** A `/` starting a token: typed, pasted, or carried in by a draft, all of which skills can chip. */
const SLASH_TOKEN = /(^|\s)\//
/** A list that never lands must not eat the message: it goes out as written after this long. */
const HELD_SEND_MAX_MS = 10_000

/** A send waiting for the skill lists, so a `/name` in it is not sent as plain text. */
interface HeldSend {
  text: string
  /** The text has been chipped against the landed lists, including a token still being typed. */
  chipped: boolean
  expired: boolean
}

/**
 * The organization composer's behavior: editing, draft sync, voice, the skill lists, and submission.
 * Its two views draw it, the extension's panel and the page's. This module stays free of the design
 * system so the extension can bundle it.
 */
export function useComposer({
  requestMode,
  onPlanChange,
  value,
  files,
  submission,
  isInitialView,
  isSending,
  onChange,
  restoredContexts,
  onSubmit,
  onSendQueuedHead,
  onEditQueuedTail,
  messages,
  onStop,
  waitsForFullLists,
  hasAdditionalAttachments,
}: UseComposerOptions) {
  const attachedFilesRef = useRef(files.attachedFiles)
  attachedFilesRef.current = files.attachedFiles
  const imagesOnly = requestMode === 'assistant'
  const { organization } = useOrganizationContext()
  const { data: allWorkspaces = [], isPending: workspacesPending } = useWorkspacesQuery(!imagesOnly)
  const waitsForLists = waitsForFullLists && !imagesOnly
  const workspaces = (imagesOnly ? [] : allWorkspaces).filter(
    (workspace) => workspace.organizationId === organization.id
  )
  // The field takes focus on load, so focus alone says nothing about wanting these per-workspace lists.
  const [resourceIntent, setResourceIntent] = useState(false)
  const [heldSend, setHeldSend] = useState<HeldSend | null>(null)
  const skillsWanted = resourceIntent || heldSend !== null || SLASH_TOKEN.test(value)
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
    skillsLoading: skillsWanted && skillListsPending,
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
    getMessages: () => messages ?? [],
  })
  const { textareaRef } = editor
  const editorRef = useRef(editor)
  editorRef.current = editor
  const lastPublished = useRef(value)
  useEffect(() => {
    if (value !== lastPublished.current) {
      editorRef.current.setValue(value)
      if (!value) editorRef.current.setContexts([])
      lastPublished.current = value
      if (value) textareaRef.current?.focus()
    }
  }, [value, textareaRef])
  const lastContexts = useRef(editor.contexts)
  useEffect(() => {
    if (editorRef.current.getValue() !== editor.value) return
    const plainValue = editorRef.current.getPlainValue()
    if (plainValue !== lastPublished.current || editor.contexts !== lastContexts.current) {
      lastPublished.current = plainValue
      lastContexts.current = editor.contexts
      onChange(plainValue, editor.contexts.length ? editor.contexts : undefined)
    }
  }, [editor.value, editor.contexts, onChange])
  useEffect(() => {
    if (!restoredContexts) return
    history.reset()
    const { hasUnavailableContexts } = editorRef.current.restorePrompt(
      editorRef.current.getPlainValue(),
      restoredContexts
    )
    if (hasUnavailableContexts) toast.info(UNAVAILABLE_CONTEXT_NOTICE)
  }, [restoredContexts, history.reset])
  useChatInputFocus({ textareaRef })
  const voice = useVoiceInput({
    organizationId: organization.id,
    getValue: () => editor.getPlainValue(),
    onChange: (text) => editor.setValue(text),
  })
  const canSubmit =
    !files.attachedFiles.some((file) => file.uploading) &&
    (value.trim().length > 0 ||
      files.attachedFiles.some((file) => file.key) ||
      hasAdditionalAttachments)

  const { pending: preparingSubmission, accept: acceptSubmission } = submission
  const send = () => {
    if (attachedFilesRef.current.some((file) => file.uploading)) return
    const hasPayload =
      editor.getValue().trim().length > 0 ||
      attachedFilesRef.current.some((file) => file.key) ||
      hasAdditionalAttachments
    if (!hasPayload) {
      if (isSending) onSendQueuedHead?.()
      return
    }
    const contexts = imagesOnly
      ? filterContextsPresentInMessage(
          editor.contexts.filter((context) => context.kind === 'browser_page'),
          editor.getPlainValue()
        )
      : editor.getActiveContexts()
    const raw = editor.getValue()
    const filesAtSend = attachedFilesRef.current
    acceptSubmission(
      () => onSubmit(editor.getPlainValue(), contexts.length ? contexts : undefined),
      () => {
        attachedFilesRef.current = []
        voice.resetTranscript()
        history.reset()
        editor.clear()
      },
      () => editorRef.current.getValue() === raw && attachedFilesRef.current === filesAtSend,
      textareaRef.current
    )
  }

  const submit = () => {
    const text = editor.getPlainValue()
    if (waitsForLists && skillListsPending && SLASH_TOKEN.test(text)) {
      setHeldSend((held) => held ?? { text, chipped: false, expired: false })
      return
    }
    send()
  }
  const sendRef = useRef(send)
  sendRef.current = send
  useEffect(() => {
    if (!heldSend || heldSend.expired) return
    const timer = setTimeout(
      () => setHeldSend((held) => held && { ...held, expired: true }),
      HELD_SEND_MAX_MS
    )
    return () => clearTimeout(timer)
  }, [heldSend])
  useEffect(() => {
    if (!heldSend) return
    if (editorRef.current.getPlainValue() !== heldSend.text) {
      setHeldSend(null)
      return
    }
    if (skillListsPending && !heldSend.expired) return
    if (!heldSend.chipped) {
      editorRef.current.setValue(heldSend.text)
      setHeldSend({ ...heldSend, chipped: true })
      return
    }
    setHeldSend(null)
    sendRef.current()
  }, [heldSend, skillListsPending, editor.value])

  const openResourceMenu = (event: { currentTarget: Element }) => {
    const rect = event.currentTarget.getBoundingClientRect()
    editor.openResourceMenu({ left: rect.left, top: rect.top })
  }
  const recallQueuedTail = () => {
    if (hasAdditionalAttachments || attachedFilesRef.current.length > 0) return false
    return onEditQueuedTail?.() ?? false
  }

  return {
    editor,
    voice,
    files,
    imagesOnly,
    requestMode,
    onPlanChange,
    value,
    isInitialView,
    isSending,
    onStop,
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

export type ComposerState = ReturnType<typeof useComposer>
