'use client'

import { useEffect, useState } from 'react'
import { toast } from '@sim/emcn-legacy'
import { useQueries } from '@tanstack/react-query'
import { usePromptEditor } from '@/components/mothership-chat/user-input/components/prompt-editor'
import { organizationSkillOptions } from '@/components/mothership-chat/user-input/components/skills-menu-dropdown/organization-skill-options'
import { usePromptHistory } from '@/components/mothership-chat/user-input/hooks/use-prompt-history'
import type { useFileAttachments } from '@/components/workflow-editor/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'
import { filterContextsPresentInMessage } from '@/components/workflow-editor/components/panel/components/copilot/components/user-input/utils'
import { UNAVAILABLE_CONTEXT_NOTICE } from '@/lib/mothership/chat/context'
import type { ChatMessage, ChatRequestMode } from '@/lib/mothership/chat/types'
import { useOrganization } from '@/lib/organizations/provider'
import { getSkillsQueryOptions } from '@/hooks/queries/skills'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'
import { useChatInputFocus } from '@/hooks/use-chat-input-focus'
import type {
  PendingComposerSubmission,
  useComposerSubmission,
} from '@/hooks/use-composer-submission'
import { useVoiceInput } from '@/hooks/use-voice-input'
import { readDraft, useMothershipDraftsStore } from '@/stores/mothership-drafts/store'
import type { ChatContext } from '@/stores/panel'

/** What the conversation hands the panel's composer. */
export interface ConversationComposerProps {
  requestMode: ChatRequestMode
  onPlanChange?: () => void
  /** Where the draft lives: written to the first key, read through the rest. */
  draftKeys: readonly string[]
  files: ReturnType<typeof useFileAttachments>
  submission: ReturnType<typeof useComposerSubmission>
  isSending: boolean
  restoredContexts: ChatContext[]
  onSubmit: (
    text: string,
    contexts?: ChatContext[]
  ) => undefined | false | PendingComposerSubmission
  messages: readonly ChatMessage[]
  onStop: () => void
}

interface UseComposerOptions extends ConversationComposerProps {
  /** Attachments the view shows itself, which count as something to send. */
  hasAdditionalAttachments?: boolean
}

/**
 * The organization composer's behavior in the extension's side panel: editing, draft sync, voice, the
 * skill lists, and submission. The skill lists load on open, so a send never waits on them.
 */
export function useComposer({
  requestMode,
  draftKeys,
  files,
  submission,
  restoredContexts,
  onSubmit,
  messages,
  hasAdditionalAttachments = false,
}: UseComposerOptions) {
  const [draftKey] = draftKeys
  const value = useMothershipDraftsStore((state) => readDraft(state.drafts, draftKeys)?.text ?? '')
  const imagesOnly = requestMode === 'assistant'
  const { organization } = useOrganization()
  const { data: allWorkspaces = [] } = useWorkspacesQuery(!imagesOnly)
  const workspaces = (imagesOnly ? [] : allWorkspaces).filter(
    (workspace) => workspace.organizationId === organization.id
  )
  // The field takes focus on load, so focus alone says nothing about wanting these per-workspace lists.
  const [resourceIntent, setResourceIntent] = useState(false)
  const skillQueries = useQueries({
    queries: workspaces.map((workspace) => getSkillsQueryOptions(workspace.id)),
  })
  const skills = imagesOnly
    ? []
    : organizationSkillOptions(
        workspaces.map((workspace, index) => ({
          ...workspace,
          skills: skillQueries[index].isPlaceholderData ? [] : (skillQueries[index].data ?? []),
        }))
      )
  const editor = usePromptEditor({
    workspaceId: '',
    availableSkills: skills,
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
   * from outside, a chat cleared, reaches the editor here.
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
    if (!hasPayload(getValue(), filesAtSend)) return
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

  const openResourceMenu = (event: { currentTarget: Element }) => {
    const rect = event.currentTarget.getBoundingClientRect()
    editor.openResourceMenu({ left: rect.left, top: rect.top })
  }

  return {
    editor,
    voice,
    imagesOnly,
    canSend: canSubmit,
    submit: send,
    openResourceMenu,
    /** Enter and the arrow keys' policy, shared by the prompt editor and the plain Assistant field. */
    keyPolicy: {
      onNavigateHistory: hasAdditionalAttachments ? undefined : history.navigate,
    },
    frameProps: {
      'aria-busy': preparingSubmission || undefined,
      inert: preparingSubmission,
      onDragEnter: files.handleDragEnter,
      onDragLeave: files.handleDragLeave,
      onDragOver: files.handleDragOver,
      onDrop: files.handleDrop,
    },
  }
}
