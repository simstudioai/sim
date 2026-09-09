'use client'

import type React from 'react'
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { Chip, cn, Tooltip, toast } from '@sim/emcn'
import { Paperclip, Plus, Slash } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import { getMothershipAttachmentPreviewUrl } from '@/lib/copilot/chat/attachment-preview'
import { SIM_RESOURCE_DRAG_TYPE, SIM_RESOURCES_DRAG_TYPE } from '@/lib/copilot/resource-types'
import { getDesktopBridge } from '@/lib/desktop'
import { MOTHERSHIP_ADD_CONTEXT_EVENT } from '@/lib/mothership/events'
import { MOTHERSHIP_ACCEPT_ATTRIBUTE } from '@/lib/uploads/utils/validation'
import { useChatSurface } from '@/app/workspace/[workspaceId]/home/components/chat-surface-context'
import {
  AnimatedPlaceholderEffect,
  AttachedFilesList,
  DropOverlay,
  MicButton,
  MicrophonePermissionHelp,
  ModeSwitcher,
  PromptEditor,
  SendButton,
  usePromptEditor,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components'
import { handleMothershipAddContextEvent } from '@/app/workspace/[workspaceId]/home/components/user-input/mothership-context-event'
import { useMothershipMode } from '@/app/workspace/[workspaceId]/home/hooks/use-mothership-mode'
import type {
  FileAttachmentForApi,
  MothershipResource,
  QueuedMessage,
} from '@/app/workspace/[workspaceId]/home/types'
import { useFileAttachments } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks'
import type { AttachedFile } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'
import { mentionifyIntegrations } from '@/blocks/integration-matcher'
import { useChatInputFocus } from '@/hooks/use-chat-input-focus'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { type SpeechToTextError, useSpeechToText } from '@/hooks/use-speech-to-text'
import { type DraftPayload, useMothershipDraftsStore } from '@/stores/mothership-drafts/store'
import type { ChatContext } from '@/stores/panel'

export type { FileAttachmentForApi } from '@/app/workspace/[workspaceId]/home/types'

const logger = createLogger('UserInput')

interface UserInputProps {
  defaultValue?: string
  draftScopeKey?: string
  onSubmit: (
    text: string,
    fileAttachments?: FileAttachmentForApi[],
    contexts?: ChatContext[]
  ) => void
  isSending: boolean
  onStopGeneration: () => void
  isInitialView?: boolean
  onSendQueuedHead?: () => void
  /**
   * Whether the composer offers Search mode. Only the Home composer answers a
   * search with documents; the workflow copilot always talks to the agent, so
   * it must not show a mode it cannot honour.
   */
  canSearch?: boolean
  /**
   * Whether the text is cleared once submitted. A search keeps its query in
   * the box, the way a search bar does, so it can be read and refined against
   * the results; a message to the agent clears, since it now lives in the
   * transcript. Defaults to clearing.
   */
  clearOnSubmit?: boolean
  /** Called when the text becomes empty after having had content, such as a search being cleared. */
  onCleared?: () => void
  onEditQueuedTail?: () => void
}

export interface UserInputHandle {
  loadQueuedMessage: (msg: QueuedMessage) => void
  /** Populates the textarea with a CURATED prompt (suggested action, template,
   * etc. — never free-form user prose), running it through `mentionifyIntegrations`
   * (bare `Slack` → `@Slack`) and then auto-mention chipification so integration
   * names chip with brand icons. Focuses the input and places the caret at the
   * end. Does NOT submit. Safe to call with the same text twice in a row. */
  populatePrompt: (text: string) => void
  /** Empties the composer and its draft, as a send does; for a question handed to the agent from outside the box. */
  clear: () => void
}

/**
 * The chat input: the {@link PromptEditor} editing core wrapped with the
 * chat-specific chrome — file attachments (browse, drag-drop, paste), voice
 * input, draft persistence, queued-message recall, and the send/stop button.
 */
const UserInputImpl = forwardRef<UserInputHandle, UserInputProps>(function UserInput(
  {
    defaultValue = '',
    draftScopeKey,
    onSubmit,
    isSending,
    onStopGeneration,
    isInitialView = true,
    onSendQueuedHead,
    onEditQueuedTail,
    canSearch = false,
    clearOnSubmit = true,
    onCleared,
  },
  ref
) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { navigateToSettings } = useSettingsNavigation()
  const { userId, onContextAdd, onContextRemove } = useChatSurface()
  const [mode] = useMothershipMode()
  const isSearch = canSearch && mode === 'search'
  const contextsEnabled = !canSearch || mode === 'build'
  const contextsEnabledRef = useRef(contextsEnabled)
  contextsEnabledRef.current = contextsEnabled
  const [microphonePermissionHelpOpen, setMicrophonePermissionHelpOpen] = useState(false)

  const [initialValue] = useState(() => {
    if (defaultValue) return defaultValue
    if (!draftScopeKey) return ''
    const text = useMothershipDraftsStore.getState().drafts[draftScopeKey]?.text
    return typeof text === 'string' ? text : ''
  })

  const prevDefaultValueRef = useRef(defaultValue)

  const files = useFileAttachments({
    userId,
    workspaceId,
    disabled: !contextsEnabled,
    isLoading: isSending,
  })
  const hasFiles = contextsEnabled && files.attachedFiles.some((f) => !f.uploading && f.key)
  const hasUploadingFiles = contextsEnabled && files.attachedFiles.some((f) => f.uploading)

  const filesRef = useRef(files)
  filesRef.current = files

  const handlePasteFiles = useCallback((pasted: FileList) => {
    if (contextsEnabledRef.current) filesRef.current.processFiles(pasted)
  }, [])

  const editor = usePromptEditor({
    workspaceId,
    initialValue,
    onContextAdd,
    onPasteFiles: handlePasteFiles,
    contextsEnabled,
  })
  const editorRef = useRef(editor)
  editorRef.current = editor
  const textareaRef = editor.textareaRef
  useChatInputFocus({ textareaRef })

  /**
   * Attaches context chips pushed from elsewhere in the app (browser/terminal
   * selection actions, the highlight-to-chat action in the file/table
   * viewers). `preventDefault` claims the event so the producer knows a live
   * input consumed it and skips its persist-and-navigate fallback.
   */
  useEffect(() => {
    const handleAddContext = (event: Event) => {
      if (contextsEnabledRef.current) handleMothershipAddContextEvent(event, editorRef.current)
    }

    window.addEventListener(MOTHERSHIP_ADD_CONTEXT_EVENT, handleAddContext)
    return () => window.removeEventListener(MOTHERSHIP_ADD_CONTEXT_EVENT, handleAddContext)
  }, [])

  const draftScopeKeyRef = useRef(draftScopeKey)
  draftScopeKeyRef.current = draftScopeKey
  const clearOnSubmitRef = useRef(clearOnSubmit)
  clearOnSubmitRef.current = clearOnSubmit

  const hasRestoredDraftRef = useRef(false)
  useEffect(() => {
    if (hasRestoredDraftRef.current || !draftScopeKey) return
    hasRestoredDraftRef.current = true
    let restoredContexts: ChatContext[] | null = null
    let restoredFiles: AttachedFile[] | null = null
    let caretText: string | null = null
    try {
      const draft = useMothershipDraftsStore.getState().drafts[draftScopeKey]
      if (!draft) return
      if (draft.contexts?.length) {
        restoredContexts = draft.contexts
      }
      if (draft.fileAttachments?.length) {
        restoredFiles = draft.fileAttachments.map((a) => ({
          id: a.id,
          name: a.filename,
          size: a.size,
          type: a.media_type,
          path: a.path ?? '',
          key: a.key,
          uploading: false,
          previewUrl: getMothershipAttachmentPreviewUrl(a),
        }))
      }
      if (typeof draft.text === 'string' && draft.text.length > 0) {
        caretText = draft.text
      }
    } catch (err) {
      logger.error('Failed to read draft, clearing', { err })
      useMothershipDraftsStore.getState().clearDraft(draftScopeKey)
      return
    }
    if (contextsEnabled && restoredContexts) editor.setContexts(restoredContexts)
    if (contextsEnabled && restoredFiles) files.restoreAttachedFiles(restoredFiles)
    if (caretText !== null) {
      const textarea = textareaRef.current
      if (textarea) {
        textarea.focus()
        textarea.setSelectionRange(caretText.length, caretText.length)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- intentional mount-only restore

  const onClearedRef = useRef(onCleared)
  onClearedRef.current = onCleared
  const hadTextRef = useRef(false)
  useEffect(() => {
    const hasText = editor.value.trim().length > 0
    if (hadTextRef.current && !hasText) onClearedRef.current?.()
    hadTextRef.current = hasText
  }, [editor.value])

  const isFirstSaveRef = useRef(true)
  const draftSaveTimerRef = useRef<number | null>(null)
  const pendingDraftRef = useRef<{ key: string; payload: DraftPayload } | null>(null)
  useEffect(() => {
    if (isFirstSaveRef.current) {
      isFirstSaveRef.current = false
      return
    }
    if (!draftScopeKeyRef.current) return
    const fileAttachments = files.attachedFiles
      .filter((f) => !f.uploading && f.key)
      .map((f) => ({
        id: f.id,
        key: f.key!,
        filename: f.name,
        media_type: f.type,
        size: f.size,
        ...(f.path ? { path: f.path } : {}),
      }))
    pendingDraftRef.current = {
      key: draftScopeKeyRef.current,
      payload: {
        text: editor.value,
        fileAttachments: fileAttachments.length > 0 ? fileAttachments : undefined,
        contexts: editor.contexts.length > 0 ? editor.contexts : undefined,
      },
    }
    if (draftSaveTimerRef.current !== null) window.clearTimeout(draftSaveTimerRef.current)
    draftSaveTimerRef.current = window.setTimeout(() => {
      const pending = pendingDraftRef.current
      if (pending) useMothershipDraftsStore.getState().setDraft(pending.key, pending.payload)
      pendingDraftRef.current = null
      draftSaveTimerRef.current = null
    }, 200)
  }, [editor.value, files.attachedFiles, editor.contexts])

  useEffect(
    () => () => {
      if (draftSaveTimerRef.current !== null) window.clearTimeout(draftSaveTimerRef.current)
      const pending = pendingDraftRef.current
      if (pending) useMothershipDraftsStore.getState().setDraft(pending.key, pending.payload)
    },
    []
  )

  const onContextRemoveRef = useRef(onContextRemove)
  onContextRemoveRef.current = onContextRemove

  const prevSelectedContextsRef = useRef<ChatContext[]>([])
  useEffect(() => {
    const prev = prevSelectedContextsRef.current
    const curr = editor.contexts
    const contextId = (ctx: ChatContext): string => {
      switch (ctx.kind) {
        case 'workflow':
        case 'current_workflow':
          return `${ctx.kind}:${ctx.workflowId}`
        case 'knowledge':
          return `knowledge:${ctx.knowledgeId ?? ''}`
        case 'table':
          return `table:${ctx.tableId}`
        case 'file':
          return `file:${ctx.fileId}`
        case 'folder':
          return `folder:${ctx.folderId}`
        case 'past_chat':
          return `past_chat:${ctx.chatId}`
        default:
          return `${ctx.kind}:${ctx.label}`
      }
    }
    const removed = prev.filter((p) => !curr.some((c) => contextId(c) === contextId(p)))
    if (removed.length > 0) removed.forEach((ctx) => onContextRemoveRef.current?.(ctx, curr))
    prevSelectedContextsRef.current = curr
  }, [editor.contexts])

  const canSubmit = (editor.value.trim().length > 0 || hasFiles) && !isSending && !hasUploadingFiles

  /**
   * Sync the editor when the `defaultValue` prop changes post-mount — e.g.
   * the user clicks a different template while UserInput is already mounted.
   * `setValue` chipifies integration `@`-mentions consistently with the
   * paste / draft restore flows.
   *
   * Deliberately does NOT run `mentionifyIntegrations` here: `defaultValue` is
   * seeded from `LandingPromptStorage`, whose producers include the free-form
   * landing prompt panel as well as curated CTAs. Curated producers opt their
   * bare names in at the store seam (`storeCuratedPrompt`), so prose seeded here
   * is never bare-chipped (the scunthorpe constraint).
   * An empty seed must not erase a queued message loaded in the same event
   * that clears the search URL. The mode menu clears its query explicitly.
   */
  useEffect(() => {
    if (defaultValue === prevDefaultValueRef.current) return
    prevDefaultValueRef.current = defaultValue
    if (defaultValue) editorRef.current.setValue(defaultValue)
  }, [defaultValue])

  const sttPrefixRef = useRef('')

  function handleTranscript(text: string) {
    const prefix = sttPrefixRef.current
    const newVal = prefix ? `${prefix} ${text}` : text
    editorRef.current.setValue(newVal)
  }

  function handleUsageLimitExceeded(message?: string, isMemberLimit?: boolean) {
    // A per-member cap can only be raised by an org admin, so don't offer Upgrade
    // (the member can't act on it) — the message already tells them to ask an admin.
    toast.error(
      message || 'You are out of credits.',
      isMemberLimit
        ? undefined
        : {
            action: {
              label: 'Upgrade',
              onClick: () => navigateToSettings({ section: 'billing' }),
            },
          }
    )
  }

  function handleSpeechError(error: SpeechToTextError) {
    if (error === 'microphone-blocked') {
      const desktopBridge = getDesktopBridge()
      if (desktopBridge) {
        const { openMicrophoneSettings } = desktopBridge
        toast.error(
          'Microphone access is blocked. Allow Sim to use the microphone in your system privacy settings.',
          openMicrophoneSettings
            ? {
                action: {
                  label: 'Open Settings',
                  onClick: () => void openMicrophoneSettings(),
                },
              }
            : undefined
        )
      } else {
        toast.error('Microphone access is blocked. Allow it for this site and try again.', {
          action: {
            label: 'Show steps',
            onClick: () => setMicrophonePermissionHelpOpen(true),
          },
        })
      }
      return
    }
    if (error === 'microphone-unavailable') {
      toast.error('No microphone found. Connect one and try again.')
      return
    }
    toast.error('Could not start voice input. Try again.')
  }

  const {
    audioLevelsRef,
    isListening,
    isSupported: isSttSupported,
    toggleListening: rawToggle,
    resetTranscript,
  } = useSpeechToText({
    onTranscript: handleTranscript,
    onUsageLimitExceeded: handleUsageLimitExceeded,
    onError: handleSpeechError,
    workspaceId,
  })

  const toggleListening = useCallback(() => {
    if (!isListening) {
      sttPrefixRef.current = editorRef.current.getValue()
    }
    rawToggle()
  }, [isListening, rawToggle])

  const onSendQueuedHeadRef = useRef(onSendQueuedHead)
  onSendQueuedHeadRef.current = onSendQueuedHead
  const onEditQueuedTailRef = useRef(onEditQueuedTail)
  onEditQueuedTailRef.current = onEditQueuedTail
  const isSendingRef = useRef(isSending)
  isSendingRef.current = isSending
  const wasSendingRef = useRef(false)
  const composerOwnsFocusRef = useRef(false)

  useImperativeHandle(
    ref,
    () => ({
      loadQueuedMessage: (msg: QueuedMessage) => {
        const currentEditor = editorRef.current
        currentEditor.setValue(msg.content)
        const restored: AttachedFile[] = (msg.fileAttachments ?? []).map((a) => ({
          id: a.id,
          name: a.filename,
          size: a.size,
          type: a.media_type,
          path: a.path ?? '',
          key: a.key,
          uploading: false,
          previewUrl: getMothershipAttachmentPreviewUrl(a),
        }))
        filesRef.current.restoreAttachedFiles(restored)
        currentEditor.setContexts(msg.contexts ?? [])
        currentEditor.focusAtEnd()
      },
      clear: clearComposer,
      populatePrompt: (text: string) => {
        // `text` is a curated prompt, so opt its bare integration names into
        // `@`-mention form before chipification (the auto-mention pipeline only
        // chips already-`@`-prefixed names). Curated prompts arriving via the
        // `defaultValue` seed are mentionified at their producer instead, since
        // that path is also reused for free-form landing prose.
        editorRef.current.setValue(mentionifyIntegrations(text))
        editorRef.current.focusAtEnd()
      },
    }),
    []
  )

  const handleFileSelectStable = useCallback(() => {
    if (contextsEnabledRef.current) filesRef.current.handleFileSelect()
  }, [])

  const handleFileClick = useCallback((file: AttachedFile) => {
    filesRef.current.handleFileClick(file)
  }, [])

  const handleRemoveFile = useCallback((id: string) => {
    filesRef.current.removeFile(id)
  }, [])

  const handleContainerDragOver = useCallback((e: React.DragEvent) => {
    if (
      e.dataTransfer.types.includes(SIM_RESOURCE_DRAG_TYPE) ||
      e.dataTransfer.types.includes(SIM_RESOURCES_DRAG_TYPE)
    ) {
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
      return
    }
    filesRef.current.handleDragOver(e)
  }, [])

  const handleContainerDrop = useCallback(
    (e: React.DragEvent) => {
      if (!contextsEnabledRef.current) {
        e.preventDefault()
        return
      }
      const resourcesJson = e.dataTransfer.getData(SIM_RESOURCES_DRAG_TYPE)
      if (resourcesJson) {
        e.preventDefault()
        e.stopPropagation()
        try {
          const resources = JSON.parse(resourcesJson) as MothershipResource[]
          editorRef.current.insertResources(resources)
        } catch {}
        textareaRef.current?.focus()
        return
      }
      const resourceJson = e.dataTransfer.getData(SIM_RESOURCE_DRAG_TYPE)
      if (resourceJson) {
        e.preventDefault()
        e.stopPropagation()
        try {
          const resource = JSON.parse(resourceJson) as MothershipResource
          editorRef.current.insertResources([resource])
        } catch {}
        textareaRef.current?.focus()
        return
      }
      filesRef.current.handleDrop(e)
      requestAnimationFrame(() => textareaRef.current?.focus())
    },
    [textareaRef]
  )

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    const isResourceDrag =
      e.dataTransfer.types.includes(SIM_RESOURCE_DRAG_TYPE) ||
      e.dataTransfer.types.includes(SIM_RESOURCES_DRAG_TYPE)
    if (!isResourceDrag) filesRef.current.handleDragEnter(e)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const isResourceDrag =
      e.dataTransfer.types.includes(SIM_RESOURCE_DRAG_TYPE) ||
      e.dataTransfer.types.includes(SIM_RESOURCES_DRAG_TYPE)
    if (!isResourceDrag) filesRef.current.handleDragLeave(e)
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    filesRef.current.handleFileChange(e)
  }, [])

  useEffect(() => {
    if (
      wasSendingRef.current &&
      !isSending &&
      composerOwnsFocusRef.current &&
      document.hasFocus()
    ) {
      textareaRef.current?.focus()
    }
    wasSendingRef.current = isSending
  }, [isSending, textareaRef])

  /**
   * Menu rows are excluded alongside buttons: the mode switcher's items are
   * portaled, so their clicks still bubble here through the React tree.
   */
  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, [role="dialog"], [role="menu"]')) return
    textareaRef.current?.focus()
  }

  /** Empties the text, chips, attachments, transcript, and the saved draft in one step. */
  const clearComposer = useCallback(() => {
    editorRef.current.clear()
    sttPrefixRef.current = ''
    if (draftSaveTimerRef.current !== null) {
      window.clearTimeout(draftSaveTimerRef.current)
      draftSaveTimerRef.current = null
    }
    pendingDraftRef.current = null
    if (draftScopeKeyRef.current) {
      useMothershipDraftsStore.getState().clearDraft(draftScopeKeyRef.current)
    }
    /** The chips are gone with the text, and clearing is not a removal to report. */
    prevSelectedContextsRef.current = []
    resetTranscript()
    filesRef.current.clearAttachedFiles()
  }, [resetTranscript])

  const handleSubmit = useCallback(() => {
    const currentFiles = filesRef.current
    const currentEditor = editorRef.current

    const fileAttachmentsForApi: FileAttachmentForApi[] = (
      contextsEnabledRef.current ? currentFiles.attachedFiles : []
    )
      .filter((f) => !f.uploading && f.key)
      .map((f) => ({
        id: f.id,
        key: f.key!,
        filename: f.name,
        media_type: f.type,
        size: f.size,
        ...(f.path ? { path: f.path } : {}),
      }))

    // getPlainValue restores skill chips' EM SPACE sentinel to a literal '/'
    // so the message reads as clean `/skill-name` (skills travel via contexts
    // regardless). Only the submitted copy is converted; the live input is not.
    const activeContexts = currentEditor.getActiveContexts()
    onSubmit(
      currentEditor.getPlainValue(),
      fileAttachmentsForApi.length > 0 ? fileAttachmentsForApi : undefined,
      activeContexts.length > 0 ? activeContexts : undefined
    )
    /**
     * A composer that keeps its text (Search mode) keeps its attachments and
     * chips too: the search took the query alone, and the person may hand the
     * rest to the agent next.
     */
    if (clearOnSubmitRef.current) clearComposer()
  }, [onSubmit, clearComposer])

  /**
   * Enter policy for the editor: mirror canSubmit's uploading guard (Enter
   * reads refs, not rendered state), queue the head message when Enter lands
   * on an empty input mid-stream, and otherwise submit.
   */
  const handleEnterSubmit = useCallback(() => {
    if (filesRef.current.attachedFiles.some((f) => f.uploading)) return
    const hasSubmitPayload =
      editorRef.current.getValue().trim().length > 0 ||
      filesRef.current.attachedFiles.some((file) => !file.uploading && file.key)
    if (!hasSubmitPayload) {
      if (isSendingRef.current) {
        onSendQueuedHeadRef.current?.()
      }
      return
    }
    handleSubmit()
  }, [handleSubmit])

  /**
   * ArrowUp-on-empty policy: recall the queued tail message for editing. Only
   * claims the key when there are no attachments and a queue handler exists.
   */
  const handleArrowUpOnEmpty = useCallback((): boolean => {
    if (filesRef.current.attachedFiles.length > 0) return false
    const onEditQueuedTail = onEditQueuedTailRef.current
    if (!onEditQueuedTail) return false
    onEditQueuedTail()
    return true
  }, [])

  const handlePlusClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    editorRef.current.openResourceMenu({ left: rect.left, top: rect.top })
  }, [])

  const handleSlashTriggerClick = useCallback(() => {
    editorRef.current.insertSlashTrigger()
  }, [])

  return (
    <div
      onClick={handleContainerClick}
      onFocusCapture={() => {
        composerOwnsFocusRef.current = true
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          composerOwnsFocusRef.current = false
        }
      }}
      className={cn(
        'relative z-10 mx-auto w-full max-w-chat cursor-text rounded-2xl border border-[var(--border-1)] bg-[var(--white)] px-2.5 py-2 dark:bg-[var(--surface-4)]',
        isInitialView && 'shadow-ambient'
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleContainerDragOver}
      onDrop={handleContainerDrop}
    >
      {!isSearch && mode !== 'assistant' && (
        <AnimatedPlaceholderEffect textareaRef={textareaRef} isInitialView={isInitialView} />
      )}

      {contextsEnabled && (
        <AttachedFilesList
          attachedFiles={files.attachedFiles}
          onFileClick={handleFileClick}
          onRemoveFile={handleRemoveFile}
        />
      )}

      <PromptEditor
        editor={editor}
        placeholder={
          isSearch
            ? 'Search your documents…'
            : mode === 'assistant'
              ? 'Ask about your documents or take action…'
              : 'Ask Sim to '
        }
        onSubmit={handleEnterSubmit}
        onArrowUpOnEmpty={handleArrowUpOnEmpty}
        className={cn('max-h-[200px]', isInitialView && 'min-h-[56px]')}
      />

      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-1'>
          {contextsEnabled && (
            <>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Chip
                    shape='round'
                    leftIcon={Plus}
                    onClick={handlePlusClick}
                    aria-label='Add resources'
                  />
                </Tooltip.Trigger>
                <Tooltip.Content side='top'>Add resources</Tooltip.Content>
              </Tooltip.Root>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Chip
                    shape='round'
                    leftIcon={Paperclip}
                    onClick={handleFileSelectStable}
                    aria-label='Attach file'
                  />
                </Tooltip.Trigger>
                <Tooltip.Content side='top'>Attach file</Tooltip.Content>
              </Tooltip.Root>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Chip
                    shape='round'
                    leftIcon={Slash}
                    onClick={handleSlashTriggerClick}
                    aria-label='Skills'
                  />
                </Tooltip.Trigger>
                <Tooltip.Content side='top'>Skills</Tooltip.Content>
              </Tooltip.Root>
            </>
          )}
        </div>
        <div className='flex items-center gap-1.5'>
          {canSearch && <ModeSwitcher onModeChange={clearComposer} />}
          {isSttSupported && (
            <MicButton
              audioLevelsRef={audioLevelsRef}
              isListening={isListening}
              onToggle={toggleListening}
            />
          )}
          <SendButton
            isSending={isSending}
            canSubmit={canSubmit}
            onSubmit={handleSubmit}
            onStopGeneration={onStopGeneration}
          />
        </div>
      </div>

      <input
        ref={files.fileInputRef}
        type='file'
        onChange={handleFileChange}
        className='hidden'
        accept={MOTHERSHIP_ACCEPT_ATTRIBUTE}
        multiple
        disabled={!contextsEnabled}
      />

      {files.isDragging && <DropOverlay />}

      <MicrophonePermissionHelp
        open={microphonePermissionHelpOpen}
        onOpenChange={setMicrophonePermissionHelpOpen}
      />
    </div>
  )
})

/**
 * Memoized so streaming ticks in the parent transcript — which re-render
 * {@link MothershipChat} on every chunk — do not re-render the entire input
 * toolbar. Relies on callers passing stable callbacks (see `MothershipChat`).
 */
export const UserInput = memo(UserInputImpl)
