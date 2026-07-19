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
import { Button, cn, Paperclip, Plus, Slash, Tooltip, toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import { getMothershipAttachmentPreviewUrl } from '@/lib/copilot/chat/attachment-preview'
import { SIM_RESOURCE_DRAG_TYPE, SIM_RESOURCES_DRAG_TYPE } from '@/lib/copilot/resource-types'
import { CHAT_ACCEPT_ATTRIBUTE } from '@/lib/uploads/utils/validation'
import { useChatSurface } from '@/app/workspace/[workspaceId]/home/components/chat-surface-context'
import {
  AnimatedPlaceholderEffect,
  AttachedFilesList,
  DropOverlay,
  MicButton,
  PromptEditor,
  SendButton,
  usePromptEditor,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components'
import type {
  FileAttachmentForApi,
  MothershipResource,
  QueuedMessage,
} from '@/app/workspace/[workspaceId]/home/types'
import { useFileAttachments } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks'
import type { AttachedFile } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'
import { mentionifyIntegrations } from '@/blocks/integration-matcher'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useSpeechToText } from '@/hooks/use-speech-to-text'
import { useMothershipDraftsStore } from '@/stores/mothership-drafts/store'
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
  onEditQueuedTail?: () => void
}

export interface UserInputHandle {
  loadQueuedMessage: (msg: QueuedMessage) => void
  clearPrompt: () => void
  /** Populates the textarea with a CURATED prompt (suggested action, template,
   * etc. — never free-form user prose), running it through `mentionifyIntegrations`
   * (bare `Slack` → `@Slack`) and then auto-mention chipification so integration
   * names chip with brand icons. Focuses the input and places the caret at the
   * end. Does NOT submit. Safe to call with the same text twice in a row. */
  populatePrompt: (text: string) => void
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
  },
  ref
) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { navigateToSettings } = useSettingsNavigation()
  const { userId, onContextAdd, onContextRemove } = useChatSurface()

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
    disabled: false,
    isLoading: isSending,
  })
  const hasFiles = files.attachedFiles.some((f) => !f.uploading && f.key)
  const hasUploadingFiles = files.attachedFiles.some((f) => f.uploading)

  const filesRef = useRef(files)
  filesRef.current = files

  const handlePasteFiles = useCallback((pasted: FileList) => {
    filesRef.current.processFiles(pasted)
  }, [])

  const editor = usePromptEditor({
    workspaceId,
    initialValue,
    onContextAdd,
    onPasteFiles: handlePasteFiles,
  })
  const editorRef = useRef(editor)
  editorRef.current = editor
  const textareaRef = editor.textareaRef

  const draftScopeKeyRef = useRef(draftScopeKey)
  draftScopeKeyRef.current = draftScopeKey

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
    if (restoredContexts) editor.setContexts(restoredContexts)
    if (restoredFiles) files.restoreAttachedFiles(restoredFiles)
    if (caretText !== null) {
      const textarea = textareaRef.current
      if (textarea) {
        textarea.focus()
        textarea.setSelectionRange(caretText.length, caretText.length)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- intentional mount-only restore

  const isFirstSaveRef = useRef(true)
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
    useMothershipDraftsStore.getState().setDraft(draftScopeKeyRef.current, {
      text: editor.value,
      fileAttachments: fileAttachments.length > 0 ? fileAttachments : undefined,
      contexts: editor.contexts.length > 0 ? editor.contexts : undefined,
    })
  }, [editor.value, files.attachedFiles, editor.contexts])

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
    if (removed.length > 0) removed.forEach((ctx) => onContextRemoveRef.current?.(ctx))
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

  const {
    isListening,
    isSupported: isSttSupported,
    toggleListening: rawToggle,
    resetTranscript,
  } = useSpeechToText({
    onTranscript: handleTranscript,
    onUsageLimitExceeded: handleUsageLimitExceeded,
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

  useImperativeHandle(
    ref,
    () => ({
      clearPrompt: () => {
        editorRef.current.clear()
        sttPrefixRef.current = ''
        if (draftScopeKeyRef.current) {
          useMothershipDraftsStore.getState().clearDraft(draftScopeKeyRef.current)
        }
      },
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
    filesRef.current.handleFileSelect()
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
    if (wasSendingRef.current && !isSending) {
      const active = document.activeElement
      const isEditingElsewhere =
        active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement
      if (!isEditingElsewhere) {
        textareaRef.current?.focus()
      }
    }
    wasSendingRef.current = isSending
  }, [isSending, textareaRef])

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      const active = document.activeElement
      const isEditingElsewhere =
        active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement
      if (!isEditingElsewhere) {
        textareaRef.current?.focus()
      }
    })
    return () => window.cancelAnimationFrame(raf)
  }, [textareaRef])

  const handleContainerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('button')) return
      textareaRef.current?.focus()
    },
    [textareaRef]
  )

  const handleSubmit = useCallback(() => {
    const currentFiles = filesRef.current
    const currentEditor = editorRef.current

    const fileAttachmentsForApi: FileAttachmentForApi[] = currentFiles.attachedFiles
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
    onSubmit(
      currentEditor.getPlainValue(),
      fileAttachmentsForApi.length > 0 ? fileAttachmentsForApi : undefined,
      currentEditor.contexts.length > 0 ? currentEditor.contexts : undefined
    )
    currentEditor.clear()
    sttPrefixRef.current = ''
    if (draftScopeKeyRef.current) {
      useMothershipDraftsStore.getState().clearDraft(draftScopeKeyRef.current)
    }
    resetTranscript()
    currentFiles.clearAttachedFiles()
    prevSelectedContextsRef.current = []
  }, [onSubmit, resetTranscript])

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
      className={cn(
        'relative z-10 mx-auto w-full max-w-[48rem] cursor-text rounded-2xl border border-[var(--border-1)] bg-[var(--white)] px-2.5 py-2 dark:bg-[var(--surface-4)]',
        isInitialView && 'shadow-sm'
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleContainerDragOver}
      onDrop={handleContainerDrop}
    >
      <AnimatedPlaceholderEffect textareaRef={textareaRef} isInitialView={isInitialView} />

      <AttachedFilesList
        attachedFiles={files.attachedFiles}
        onFileClick={handleFileClick}
        onRemoveFile={handleRemoveFile}
      />

      <PromptEditor
        editor={editor}
        placeholder='Ask Sim to '
        onSubmit={handleEnterSubmit}
        onArrowUpOnEmpty={handleArrowUpOnEmpty}
        className={isInitialView ? 'max-h-[30vh]' : 'max-h-[200px]'}
      />

      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-1'>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                type='button'
                variant='ghost'
                onClick={handlePlusClick}
                aria-label='Add resources'
                className='size-[28px] rounded-full p-0 hover-hover:bg-[var(--surface-hover)]'
              >
                <Plus className='size-[16px] text-[var(--text-icon)]' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>Add resources</Tooltip.Content>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                type='button'
                variant='ghost'
                onClick={handleFileSelectStable}
                aria-label='Attach file'
                className='size-[28px] rounded-full p-0 hover-hover:bg-[var(--surface-hover)]'
              >
                <Paperclip className='size-[16px] text-[var(--text-icon)]' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>Attach file</Tooltip.Content>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                type='button'
                variant='ghost'
                onClick={handleSlashTriggerClick}
                aria-label='Skills'
                className='size-[28px] rounded-full p-0 hover-hover:bg-[var(--surface-hover)]'
              >
                <Slash className='size-[16px] text-[var(--text-icon)]' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>Skills</Tooltip.Content>
          </Tooltip.Root>
        </div>
        <div className='flex items-center gap-1.5'>
          {isSttSupported && <MicButton isListening={isListening} onToggle={toggleListening} />}
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
        accept={CHAT_ACCEPT_ATTRIBUTE}
        multiple
      />

      {files.isDragging && <DropOverlay />}
    </div>
  )
})

/**
 * Memoized so streaming ticks in the parent transcript — which re-render
 * {@link MothershipChat} on every chunk — do not re-render the entire input
 * toolbar. Relies on callers passing stable callbacks (see `MothershipChat`).
 */
export const UserInput = memo(UserInputImpl)
