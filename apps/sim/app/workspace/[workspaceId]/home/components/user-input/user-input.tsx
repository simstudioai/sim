'use client'

import type React from 'react'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import { Button, Paperclip, Slash, Tooltip, toast } from '@/components/emcn'
import { getMothershipAttachmentPreviewUrl } from '@/lib/copilot/chat/attachment-preview'
import { SIM_RESOURCE_DRAG_TYPE, SIM_RESOURCES_DRAG_TYPE } from '@/lib/copilot/resource-types'
import { cn } from '@/lib/core/utils/cn'
import { CHAT_ACCEPT_ATTRIBUTE } from '@/lib/uploads/utils/validation'
import { ContextMentionIcon } from '@/app/workspace/[workspaceId]/home/components/context-mention-icon'
import { useAvailableResources } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown'
import { snapSelectionToChips } from '@/app/workspace/[workspaceId]/home/components/user-input/chip-selection'
import type {
  PlusMenuHandle,
  SkillsMenuHandle,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components'
import {
  AnimatedPlaceholderEffect,
  AttachedFilesList,
  chipDisplayToken,
  chipLinkToContext,
  DropOverlay,
  MicButton,
  mapResourceToContext,
  OVERLAY_CLASSES,
  PlusMenuDropdown,
  parseChipLinks,
  SCROLLER_CLASSES,
  SendButton,
  SkillsMenuDropdown,
  serializeSelectionForClipboard,
  TEXTAREA_BASE_CLASSES,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components'
import { useSkillAutoMention } from '@/app/workspace/[workspaceId]/home/components/user-input/hooks/use-skill-auto-mention'
import type {
  FileAttachmentForApi,
  MothershipResource,
  QueuedMessage,
} from '@/app/workspace/[workspaceId]/home/types'
import {
  useContextManagement,
  useFileAttachments,
  useIntegrationAutoMention,
  useMentionMenu,
  useMentionTokens,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks'
import type { AttachedFile } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'
import {
  computeMentionHighlightRanges,
  extractContextTokens,
  restoreSkillTriggerText,
  SKILL_CHIP_TRIGGER,
  stripMentionTrigger,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'
import { mentionifyIntegrations } from '@/blocks/integration-matcher'
import { type SkillDefinition, useSkills } from '@/hooks/queries/skills'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useSpeechToText } from '@/hooks/use-speech-to-text'
import { useMothershipDraftsStore } from '@/stores/mothership-drafts/store'
import type { ChatContext } from '@/stores/panel'

export type { FileAttachmentForApi } from '@/app/workspace/[workspaceId]/home/types'

const logger = createLogger('UserInput')

function getCaretAnchor(
  textarea: HTMLTextAreaElement,
  caretPos: number
): { left: number; top: number } {
  const textareaRect = textarea.getBoundingClientRect()
  const style = window.getComputedStyle(textarea)

  const mirror = document.createElement('div')
  mirror.style.position = 'absolute'
  mirror.style.top = '0'
  mirror.style.left = '0'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'
  mirror.style.font = style.font
  mirror.style.padding = style.padding
  mirror.style.border = style.border
  mirror.style.width = style.width
  mirror.style.lineHeight = style.lineHeight
  mirror.style.boxSizing = style.boxSizing
  mirror.style.letterSpacing = style.letterSpacing
  mirror.style.textTransform = style.textTransform
  mirror.style.textIndent = style.textIndent
  mirror.style.textAlign = style.textAlign
  mirror.textContent = textarea.value.substring(0, caretPos)

  const marker = document.createElement('span')
  marker.style.display = 'inline-block'
  marker.style.width = '0px'
  marker.style.padding = '0'
  marker.style.border = '0'
  marker.style.verticalAlign = 'text-top'
  mirror.appendChild(marker)

  document.body.appendChild(mirror)
  const markerRect = marker.getBoundingClientRect()
  const mirrorRect = mirror.getBoundingClientRect()
  document.body.removeChild(mirror)

  return {
    left: textareaRect.left + (markerRect.left - mirrorRect.left) - textarea.scrollLeft,
    top: textareaRect.top + (markerRect.top - mirrorRect.top) - textarea.scrollTop,
  }
}

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
  userId?: string
  onContextAdd?: (context: ChatContext) => void
  onContextRemove?: (context: ChatContext) => void
  onSendQueuedHead?: () => void
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
}

export const UserInput = forwardRef<UserInputHandle, UserInputProps>(function UserInput(
  {
    defaultValue = '',
    draftScopeKey,
    onSubmit,
    isSending,
    onStopGeneration,
    isInitialView = true,
    userId,
    onContextAdd,
    onContextRemove,
    onSendQueuedHead,
    onEditQueuedTail,
  },
  ref
) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { navigateToSettings } = useSettingsNavigation()
  const { data: skills = [] } = useSkills(workspaceId)
  const [value, setValue] = useState(() => {
    if (defaultValue) return defaultValue
    if (!draftScopeKey) return ''
    const text = useMothershipDraftsStore.getState().drafts[draftScopeKey]?.text
    return typeof text === 'string' ? text : ''
  })
  const valueRef = useRef(value)
  valueRef.current = value
  const plusMenuRef = useRef<PlusMenuHandle>(null)
  const skillsMenuRef = useRef<SkillsMenuHandle>(null)

  const prevDefaultValueRef = useRef(defaultValue)

  const files = useFileAttachments({
    userId,
    workspaceId,
    disabled: false,
    isLoading: isSending,
  })
  const hasFiles = files.attachedFiles.some((f) => !f.uploading && f.key)
  const hasUploadingFiles = files.attachedFiles.some((f) => f.uploading)

  const contextManagement = useContextManagement({ message: value })

  const { addContext } = contextManagement

  const handleContextAdd = useCallback(
    (context: ChatContext) => {
      addContext(context)
      onContextAdd?.(context)
    },
    [addContext, onContextAdd]
  )

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
    if (restoredContexts) contextManagement.setSelectedContexts(restoredContexts)
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
      text: value,
      fileAttachments: fileAttachments.length > 0 ? fileAttachments : undefined,
      contexts:
        contextManagement.selectedContexts.length > 0
          ? contextManagement.selectedContexts
          : undefined,
    })
  }, [value, files.attachedFiles, contextManagement.selectedContexts])

  const onContextRemoveRef = useRef(onContextRemove)
  onContextRemoveRef.current = onContextRemove

  const prevSelectedContextsRef = useRef<ChatContext[]>([])
  useEffect(() => {
    const prev = prevSelectedContextsRef.current
    const curr = contextManagement.selectedContexts
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
  }, [contextManagement.selectedContexts])

  const existingResourceKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const ctx of contextManagement.selectedContexts) {
      if (ctx.kind === 'workflow' && ctx.workflowId) keys.add(`workflow:${ctx.workflowId}`)
      if (ctx.kind === 'knowledge' && ctx.knowledgeId) keys.add(`knowledgebase:${ctx.knowledgeId}`)
      if (ctx.kind === 'table' && ctx.tableId) keys.add(`table:${ctx.tableId}`)
      if (ctx.kind === 'file' && ctx.fileId) keys.add(`file:${ctx.fileId}`)
      if (ctx.kind === 'folder' && ctx.folderId) keys.add(`folder:${ctx.folderId}`)
      if (ctx.kind === 'past_chat' && ctx.chatId) keys.add(`task:${ctx.chatId}`)
    }
    return keys
  }, [contextManagement.selectedContexts])

  const availableResources = useAvailableResources(workspaceId, existingResourceKeys)

  const mentionMenu = useMentionMenu({
    message: value,
    selectedContexts: contextManagement.selectedContexts,
    onContextSelect: handleContextAdd,
    onMessageChange: setValue,
  })

  const mentionTokensWithContext = useMentionTokens({
    message: value,
    selectedContexts: contextManagement.selectedContexts,
    mentionMenu,
    setMessage: setValue,
  })

  const integrationAutoMention = useIntegrationAutoMention({
    setSelectedContexts: contextManagement.setSelectedContexts,
  })

  const skillAutoMention = useSkillAutoMention({
    skills,
    setSelectedContexts: contextManagement.setSelectedContexts,
  })

  /**
   * Bulk-chipifies a block of text on the non-keystroke paths (mount, template,
   * draft restore, STT, queued message, multi-char paste): explicit integration
   * `@`-mentions first (casing canonicalized; bare names are never touched),
   * then skill `/` triggers (swapped to the sentinel). Returns the fully
   * converted text and registers both context kinds.
   */
  const applyAutoMentions = useCallback(
    (text: string) => skillAutoMention.applyToText(integrationAutoMention.applyToText(text)),
    [skillAutoMention.applyToText, integrationAutoMention.applyToText]
  )

  const canSubmit = (value.trim().length > 0 || hasFiles) && !isSending && !hasUploadingFiles

  /**
   * Canonicalize integration `@`-mentions on mount for any initial value
   * seeded by `defaultValue` or a restored mothership draft. Mid-typing
   * conversion is intentionally NOT handled here — the keystroke fast-path
   * in `handleInputChange` covers that case via `processChange`, and running
   * it on every value change would rewrite tokens while the user is still
   * typing the name and prematurely open the mention menu.
   */
  useEffect(() => {
    if (!valueRef.current) return
    const original = valueRef.current
    const converted = applyAutoMentions(original)
    if (converted !== original) setValue(converted)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Sync `value` when the `defaultValue` prop changes post-mount — e.g.
   * the user clicks a different template while UserInput is already
   * mounted. Mirrors the previously inline render-phase derivation but
   * now runs the prompt through `applyToText` so integration `@`-mentions
   * get chipified consistently with paste / draft restore flows.
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
    if (defaultValue) setValue(applyAutoMentions(defaultValue))
  }, [defaultValue, applyAutoMentions])

  const sttPrefixRef = useRef('')

  function handleTranscript(text: string) {
    const prefix = sttPrefixRef.current
    const newVal = prefix ? `${prefix} ${text}` : text
    const converted = applyAutoMentions(newVal)
    setValue(converted)
    valueRef.current = converted
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
      sttPrefixRef.current = valueRef.current
    }
    rawToggle()
  }, [isListening, rawToggle])

  const filesRef = useRef(files)
  filesRef.current = files
  const contextRef = useRef(contextManagement)
  contextRef.current = contextManagement
  const onSendQueuedHeadRef = useRef(onSendQueuedHead)
  onSendQueuedHeadRef.current = onSendQueuedHead
  const onEditQueuedTailRef = useRef(onEditQueuedTail)
  onEditQueuedTailRef.current = onEditQueuedTail
  const isSendingRef = useRef(isSending)
  isSendingRef.current = isSending

  const textareaRef = mentionMenu.textareaRef
  const wasSendingRef = useRef(false)
  const atInsertPosRef = useRef<number | null>(null)
  const pendingCursorRef = useRef<number | null>(null)
  const mentionRangeRef = useRef<{ start: number; end: number } | null>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const slashRangeRef = useRef<{ start: number; end: number } | null>(null)
  const [slashQuery, setSlashQuery] = useState<string | null>(null)

  const focusTextareaAtEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      const end = textarea.value.length
      textarea.setSelectionRange(end, end)
    })
  }, [textareaRef])

  useImperativeHandle(
    ref,
    () => ({
      loadQueuedMessage: (msg: QueuedMessage) => {
        setValue(applyAutoMentions(msg.content))
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
        files.restoreAttachedFiles(restored)
        contextManagement.setSelectedContexts(msg.contexts ?? [])
        focusTextareaAtEnd()
      },
      populatePrompt: (text: string) => {
        // `text` is a curated prompt, so opt its bare integration names into
        // `@`-mention form before chipification (the auto-mention pipeline only
        // chips already-`@`-prefixed names). Curated prompts arriving via the
        // `defaultValue` seed are mentionified at their producer instead, since
        // that path is also reused for free-form landing prose.
        setValue(applyAutoMentions(mentionifyIntegrations(text)))
        focusTextareaAtEnd()
      },
    }),
    [
      files.restoreAttachedFiles,
      contextManagement.setSelectedContexts,
      focusTextareaAtEnd,
      applyAutoMentions,
    ]
  )

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    // Grow the textarea to its full content height; the scroller caps the
    // visible height and scrolls textarea + overlay together natively.
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [value, textareaRef])

  const handleResourceSelect = useCallback(
    (resource: MothershipResource) => {
      const textarea = textareaRef.current
      if (textarea) {
        const currentValue = valueRef.current
        const range = mentionRangeRef.current
        let before: string
        let after: string
        let insertText: string
        let newPos: number

        if (range) {
          before = currentValue.slice(0, range.start)
          after = currentValue.slice(range.end)
          const needsSpaceBefore =
            range.start > 0 && !/\s/.test(currentValue.charAt(range.start - 1))
          insertText = `${needsSpaceBefore ? ' ' : ''}@${resource.title} `
          newPos = before.length + insertText.length
        } else {
          const insertAt = atInsertPosRef.current ?? textarea.selectionStart ?? currentValue.length
          const needsSpaceBefore = insertAt > 0 && !/\s/.test(currentValue.charAt(insertAt - 1))
          insertText = `${needsSpaceBefore ? ' ' : ''}@${resource.title} `
          before = currentValue.slice(0, insertAt)
          after = currentValue.slice(insertAt)
          newPos = before.length + insertText.length
        }

        const newValue = `${before}${insertText}${after}`
        pendingCursorRef.current = newPos
        valueRef.current = newValue
        atInsertPosRef.current = newPos
        mentionRangeRef.current = null
        setMentionQuery(null)
        setValue(newValue)
      }

      const context = mapResourceToContext(resource)
      handleContextAdd(context)
    },
    [textareaRef, handleContextAdd]
  )

  const handleSkillSelect = useCallback(
    (skill: SkillDefinition) => {
      const textarea = textareaRef.current
      if (textarea) {
        const currentValue = valueRef.current
        const range = slashRangeRef.current
        let before: string
        let after: string
        let insertText: string
        let newPos: number

        if (range) {
          before = currentValue.slice(0, range.start)
          after = currentValue.slice(range.end)
          const needsSpaceBefore =
            range.start > 0 && !/\s/.test(currentValue.charAt(range.start - 1))
          insertText = `${needsSpaceBefore ? ' ' : ''}${SKILL_CHIP_TRIGGER}${skill.name} `
          newPos = before.length + insertText.length
        } else {
          const insertAt = textarea.selectionStart ?? currentValue.length
          const needsSpaceBefore = insertAt > 0 && !/\s/.test(currentValue.charAt(insertAt - 1))
          insertText = `${needsSpaceBefore ? ' ' : ''}${SKILL_CHIP_TRIGGER}${skill.name} `
          before = currentValue.slice(0, insertAt)
          after = currentValue.slice(insertAt)
          newPos = before.length + insertText.length
        }

        const newValue = `${before}${insertText}${after}`
        pendingCursorRef.current = newPos
        valueRef.current = newValue
        slashRangeRef.current = null
        setSlashQuery(null)
        setValue(newValue)
      }

      handleContextAdd({ kind: 'skill', skillId: skill.id, label: skill.name })
    },
    [textareaRef, handleContextAdd]
  )

  const handleSkillsMenuClose = useCallback(() => {
    slashRangeRef.current = null
    setSlashQuery(null)
  }, [])

  const handlePlusMenuClose = useCallback(() => {
    atInsertPosRef.current = null
    mentionRangeRef.current = null
    setMentionQuery(null)
  }, [])

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
          for (const resource of resources) {
            handleResourceSelect(resource)
          }
          // Reset after batch so the next non-drop insert uses the cursor position
          atInsertPosRef.current = null
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
          handleResourceSelect(resource)
          atInsertPosRef.current = null
        } catch {}
        textareaRef.current?.focus()
        return
      }
      filesRef.current.handleDrop(e)
      requestAnimationFrame(() => textareaRef.current?.focus())
    },
    [handleResourceSelect, textareaRef]
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
    const currentContext = contextRef.current
    const currentValue = valueRef.current

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

    // Skill chips store an EM SPACE sentinel in place of '/' so the centered
    // icon fits its overlay slot. Restore the literal '/' in the outgoing text
    // so the message reads as clean `/skill-name` (skills travel via contexts
    // regardless). Only the submitted copy is converted; the live input is not.
    const submittedValue = restoreSkillTriggerText(currentValue)

    onSubmit(
      submittedValue,
      fileAttachmentsForApi.length > 0 ? fileAttachmentsForApi : undefined,
      currentContext.selectedContexts.length > 0 ? currentContext.selectedContexts : undefined
    )
    setValue('')
    valueRef.current = ''
    sttPrefixRef.current = ''
    if (draftScopeKeyRef.current) {
      useMothershipDraftsStore.getState().clearDraft(draftScopeKeyRef.current)
    }
    resetTranscript()
    currentFiles.clearAttachedFiles()
    prevSelectedContextsRef.current = []
    currentContext.clearContexts()
    // Programmatic close() bypasses Radix's onOpenChange, so handlePlusMenuClose won't
    // fire — clear mention state inline so ArrowUp etc. aren't intercepted post-submit.
    plusMenuRef.current?.close()
    mentionRangeRef.current = null
    setMentionQuery(null)
    skillsMenuRef.current?.close()
    slashRangeRef.current = null
    setSlashQuery(null)

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [onSubmit, textareaRef, resetTranscript])

  /**
   * Adopts the textarea's DOM value into state. State and DOM can only drift
   * when an edit's input event is lost (programmatic edits pair setValue
   * synchronously) — the DOM is the user's intent.
   */
  const adoptDomValue = useCallback((textarea: HTMLTextAreaElement) => {
    valueRef.current = textarea.value
    setValue(textarea.value)
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (mentionRangeRef.current && !e.nativeEvent.isComposing) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          plusMenuRef.current?.moveActive(1)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          plusMenuRef.current?.moveActive(-1)
          return
        }
        if ((e.key === 'Tab' || e.key === 'Enter') && !e.shiftKey) {
          // Confirm the highlighted match if there is one. If no items match, fall
          // through so Enter still submits and Tab still does its default thing.
          if (plusMenuRef.current?.selectActive()) {
            e.preventDefault()
            return
          }
        }
      }

      if (slashRangeRef.current && !e.nativeEvent.isComposing) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          skillsMenuRef.current?.moveActive(1)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          skillsMenuRef.current?.moveActive(-1)
          return
        }
        if ((e.key === 'Tab' || e.key === 'Enter') && !e.shiftKey) {
          // Confirm the highlighted skill if there is one. If no items match, fall
          // through so Enter still submits and Tab still does its default thing.
          if (skillsMenuRef.current?.selectActive()) {
            e.preventDefault()
            return
          }
        }
      }

      if (e.key === 'ArrowUp' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const isEmpty = valueRef.current.length === 0 && filesRef.current.attachedFiles.length === 0
        if (isEmpty && onEditQueuedTailRef.current) {
          e.preventDefault()
          onEditQueuedTailRef.current()
          return
        }
      }

      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        // Mirror canSubmit's uploading guard; Enter reads refs, not rendered state.
        if (filesRef.current.attachedFiles.some((f) => f.uploading)) return
        const hasSubmitPayload =
          valueRef.current.trim().length > 0 ||
          filesRef.current.attachedFiles.some((file) => !file.uploading && file.key)
        if (!hasSubmitPayload) {
          if (isSendingRef.current) {
            onSendQueuedHeadRef.current?.()
          }
          return
        }
        handleSubmit()
        return
      }

      const textarea = textareaRef.current
      const selStart = textarea?.selectionStart ?? 0
      const selEnd = textarea?.selectionEnd ?? selStart
      const selectionLength = Math.abs(selEnd - selStart)

      // Single-chip delete: remove the token's text atomically. A selection
      // delete falls through to the native edit; either way the context-sync
      // effect prunes contexts whose last token is gone. Cmd+Backspace
      // (delete to line start) stays native — it spans more than one chip.
      if ((e.key === 'Backspace' || e.key === 'Delete') && selectionLength === 0 && !e.metaKey) {
        const ranges = mentionTokensWithContext.mentionRanges
        const target =
          e.key === 'Backspace'
            ? ranges.find((r) => selStart > r.start && selStart <= r.end)
            : ranges.find((r) => selStart >= r.start && selStart < r.end)

        if (target) {
          e.preventDefault()
          mentionTokensWithContext.deleteRange(target)
          return
        }
      }

      // Hop chips on plain arrows only: Shift/Cmd/Alt/Ctrl variants and IME
      // composition keep native handling; the select handler snaps any
      // resulting edge inside a chip to a chip boundary.
      if (
        selectionLength === 0 &&
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
        !e.shiftKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.nativeEvent.isComposing
      ) {
        if (textarea) {
          if (e.key === 'ArrowLeft') {
            const nextPos = Math.max(0, selStart - 1)
            const r = mentionTokensWithContext.findRangeContaining(nextPos)
            if (r) {
              e.preventDefault()
              const target = r.start
              setTimeout(() => textarea.setSelectionRange(target, target), 0)
              return
            }
          } else if (e.key === 'ArrowRight') {
            const nextPos = Math.min(value.length, selStart + 1)
            const r = mentionTokensWithContext.findRangeContaining(nextPos)
            if (r) {
              e.preventDefault()
              const target = r.end
              setTimeout(() => textarea.setSelectionRange(target, target), 0)
              return
            }
          }
        }
      }

      // Block typing inside a chip (snap to its end instead). Cmd/Ctrl
      // shortcuts (Cmd+A, Cmd+C, ...) don't insert text and must pass through.
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
        const blocked =
          selectionLength === 0 && !!mentionTokensWithContext.findRangeContaining(selStart)
        if (blocked) {
          e.preventDefault()
          const r = mentionTokensWithContext.findRangeContaining(selStart)
          if (r && textarea) {
            setTimeout(() => {
              textarea.setSelectionRange(r.end, r.end)
            }, 0)
          }
          return
        }
      }
    },
    [handleSubmit, mentionTokensWithContext, value, textareaRef]
  )

  const getActiveMentionAtRef = useRef(mentionMenu.getActiveMentionQueryAtPosition)
  getActiveMentionAtRef.current = mentionMenu.getActiveMentionQueryAtPosition

  const getActiveSlashAtRef = useRef(mentionMenu.getActiveSlashQueryAtPosition)
  getActiveSlashAtRef.current = mentionMenu.getActiveSlashQueryAtPosition

  const syncMentionState = useCallback(
    (textarea: HTMLTextAreaElement, text: string, caret: number) => {
      const active = getActiveMentionAtRef.current(caret, text)
      // Any word-boundary character inside the query — whitespace, sentence
      // punctuation, or brackets — dismisses the menu. The mention token
      // is "complete" the moment the user types a non-word character, so
      // there's nothing more to query. Mirrors the boundary set the
      // integration auto-detector uses for symmetry.
      const isOpenable = active && !/[\s.,;:!?(){}[\]"'`/\\<>]/.test(active.query)
      if (!isOpenable) {
        if (mentionRangeRef.current !== null) {
          mentionRangeRef.current = null
          setMentionQuery(null)
          plusMenuRef.current?.close()
        }
        return
      }

      const wasActive = mentionRangeRef.current !== null
      mentionRangeRef.current = { start: active.start, end: active.end }
      setMentionQuery(active.query)
      if (!wasActive) {
        // Anchor at the caret so the menu floats above the user's cursor.
        const anchor = getCaretAnchor(textarea, active.start)
        plusMenuRef.current?.open(anchor, { mention: true })
      }
    },
    []
  )

  const syncSlashState = useCallback(
    (textarea: HTMLTextAreaElement, text: string, caret: number) => {
      const active = getActiveSlashAtRef.current(caret, text)
      // Any word-boundary character inside the query dismisses the menu. The
      // boundary set intentionally excludes `/` so the slash itself doesn't
      // self-dismiss the menu it just opened.
      const isOpenable = active && !/[\s.,;:!?(){}[\]"'`\\<>]/.test(active.query)
      if (!isOpenable) {
        if (slashRangeRef.current !== null) {
          slashRangeRef.current = null
          setSlashQuery(null)
          skillsMenuRef.current?.close()
        }
        return
      }

      const wasActive = slashRangeRef.current !== null
      slashRangeRef.current = { start: active.start, end: active.end }
      setSlashQuery(active.query)
      if (!wasActive) {
        // Anchor at the caret so the menu floats above the user's cursor.
        const anchor = getCaretAnchor(textarea, active.start)
        skillsMenuRef.current?.open(anchor)
      }
    },
    []
  )

  const handleSlashTriggerClick = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.focus()

    const currentValue = valueRef.current
    const insertAt = textarea.selectionStart ?? currentValue.length
    // A `/` only triggers the menu when it starts a token (at start or after
    // whitespace). Insert a leading space when the preceding char isn't one.
    const needsSpaceBefore = insertAt > 0 && !/\s/.test(currentValue.charAt(insertAt - 1))
    const insertText = `${needsSpaceBefore ? ' ' : ''}/`
    const before = currentValue.slice(0, insertAt)
    const after = currentValue.slice(insertAt)
    const newValue = `${before}${insertText}${after}`
    const newCaret = before.length + insertText.length

    valueRef.current = newValue
    setValue(newValue)
    textarea.value = newValue
    textarea.setSelectionRange(newCaret, newCaret)
    syncSlashState(textarea, newValue, newCaret)
  }, [textareaRef, syncSlashState])

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const previousValue = valueRef.current
      const nextValue = e.target.value

      let finalValue = nextValue
      if (nextValue.length === previousValue.length + 1) {
        // Single-char keystroke — synchronous, boundary-triggered.
        finalValue = integrationAutoMention.processChange({
          textarea: e.target,
          previousValue,
          nextValue,
        })
        // Run skills on the post-integration value so a completed `/name` token
        // chips. A confirmed skill rewrites its leading `/` to the wide sentinel
        // (in the textarea and in the returned value) so the centered icon fits.
        finalValue = skillAutoMention.processChange({
          textarea: e.target,
          previousValue,
          nextValue: finalValue,
        })
      } else if (nextValue.length > previousValue.length + 1) {
        // Multi-char insertion (paste, drag-drop, IME commit) — bulk convert all
        // matches and rewrite the textarea via `setRangeText` to keep the edit
        // in a single native undo step.
        finalValue = applyAutoMentions(nextValue)
        if (finalValue !== nextValue) {
          const caretBefore = e.target.selectionStart ?? nextValue.length
          e.target.setRangeText(finalValue, 0, nextValue.length, 'preserve')
          // Replacing the whole value leaves the selection spanning the replaced
          // range (it would select all the text). Collapse the caret to its
          // converted position: only insertions BEFORE the caret should shift
          // it, so measure the converted length of just the leading slice (a
          // converted name after the caret must not move it). The re-registered
          // contexts dedupe in `mergeContexts`, so this is side-effect-safe.
          const caretAfter = applyAutoMentions(nextValue.slice(0, caretBefore)).length
          e.target.setSelectionRange(caretAfter, caretAfter)
        }
      }

      const caret = e.target.selectionStart ?? finalValue.length
      setValue(finalValue)
      syncMentionState(e.target, finalValue, caret)
      syncSlashState(e.target, finalValue, caret)
    },
    [
      applyAutoMentions,
      integrationAutoMention.processChange,
      skillAutoMention.processChange,
      syncMentionState,
      syncSlashState,
    ]
  )

  // Selection one change ago, used to infer which edge of a range moved. Kept
  // current by the `selectionchange` listener below — which fires on EVERY
  // caret/selection change (typing, arrows, clicks, programmatic), unlike
  // `select`/`mouseup` — so the inference is never fed a stale `prev`.
  const prevSelectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 })

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    let last = { start: 0, end: 0 }
    const onSelectionChange = () => {
      if (document.activeElement !== textarea) return
      prevSelectionRef.current = last
      last = { start: textarea.selectionStart ?? 0, end: textarea.selectionEnd ?? 0 }
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [textareaRef])

  /**
   * Keeps mention chips atomic under every selection gesture. A collapsed
   * caret inside a chip snaps to the nearest edge; a ranged selection edge
   * inside a chip snaps to a chip boundary — never collapsed — so select-all,
   * Shift+arrows, drag, and double-click all select chips whole.
   */
  const handleSelectAdjust = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart ?? 0
    const end = textarea.selectionEnd ?? 0
    const prev = prevSelectionRef.current

    // Adopt value changes that bypassed React's change tracking (browser
    // autofill, password managers, grammar extensions — see facebook/react#2125)
    // so state never drifts from the DOM. Skip when state is empty: submit clears
    // `value` synchronously, but a select/mouseUp can fire while the textarea
    // still holds the just-sent text, and adopting it would resurrect the message.
    if (valueRef.current !== '' && textarea.value !== valueRef.current) {
      adoptDomValue(textarea)
      return
    }

    const startChip = mentionTokensWithContext.findRangeContaining(start)
    const endChip = start === end ? startChip : mentionTokensWithContext.findRangeContaining(end)
    const snapped = snapSelectionToChips({ start, end }, prev, startChip, endChip)

    if (snapped.start !== start || snapped.end !== end) {
      // Deferred so in-flight click/drag processing can't override the write,
      // and bailed if the selection moved again first. The write re-fires this
      // handler, which then syncs the menus.
      setTimeout(() => {
        if (textarea.selectionStart !== start || textarea.selectionEnd !== end) return
        textarea.setSelectionRange(
          snapped.start,
          snapped.end,
          textarea.selectionDirection ?? undefined
        )
      }, 0)
      return
    }

    const focusPos = textarea.selectionDirection === 'backward' ? start : end
    syncMentionState(textarea, textarea.value, focusPos)
    syncSlashState(textarea, textarea.value, focusPos)
  }, [textareaRef, mentionTokensWithContext, adoptDomValue, syncMentionState, syncSlashState])

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget

    // Portable chip links (`[label](sim:kind/id)`) re-create their chip on
    // paste-back. Rewrite each link span to its `@label ` token (the trailing
    // space is REQUIRED so useContextManagement's sync effect doesn't purge the
    // freshly-added context) and register the contexts directly.
    const pastedText = e.clipboardData?.getData('text/plain') ?? ''
    const links = parseChipLinks(pastedText)
    if (links.length > 0) {
      e.preventDefault()

      const pastedContexts: ChatContext[] = []
      let rewritten = ''
      let cursor = 0
      for (let i = 0; i < links.length; i++) {
        const link = links[i]
        let between = pastedText.slice(cursor, link.start)
        // Self-heal: a run of plain spaces sitting ENTIRELY between two chips is
        // glue the codec re-emits, so collapse it to one space — gaps accumulated
        // by earlier pastes clean themselves up. Newlines and prose-bordering
        // whitespace contain non-space chars and are left verbatim.
        if (i > 0 && /^ +$/.test(between)) between = ' '
        rewritten += between
        const ctx = chipLinkToContext(link)
        pastedContexts.push(ctx)
        // Insert the kind-correct token (skill EM-SPACE sentinel, slash `/`, `@`
        // else) so the chip re-renders with its proper trigger glyph and the
        // context-sync effect (keyed on the same per-kind prefix) keeps it. Append
        // a single separator ONLY when the next source char is non-whitespace
        // (chip→chip / chip→word); existing whitespace and end-of-string already
        // supply the boundary, so re-pasting never accumulates spaces.
        const next = pastedText.charAt(link.end)
        rewritten += /\S/.test(next) ? `${chipDisplayToken(ctx)} ` : chipDisplayToken(ctx)
        cursor = link.end
      }
      rewritten += pastedText.slice(cursor)

      const selStart = textarea.selectionStart ?? valueRef.current.length
      const selEnd = textarea.selectionEnd ?? selStart
      const needsSpaceBefore =
        selStart > 0 &&
        !/\s/.test(valueRef.current.charAt(selStart - 1)) &&
        /^[@/\u2003]/.test(rewritten)
      const insert = needsSpaceBefore ? ` ${rewritten}` : rewritten

      textarea.setRangeText(insert, selStart, selEnd, 'end')
      const newValue = textarea.value
      const caret = selStart + insert.length

      // Use addContext directly — NOT handleContextAdd — so pasting does NOT
      // auto-open the resource side panel (handleContextAdd fires onContextAdd).
      for (const ctx of pastedContexts) contextRef.current.addContext(ctx)

      valueRef.current = newValue
      setValue(newValue)
      requestAnimationFrame(() => {
        const ta = textareaRef.current
        if (ta) ta.setSelectionRange(caret, caret)
      })
      return
    }

    const items = e.clipboardData?.items
    if (!items) return

    const pastedFiles: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file) pastedFiles.push(file)
      }
    }

    if (pastedFiles.length === 0) return

    e.preventDefault()
    const dt = new DataTransfer()
    for (const file of pastedFiles) {
      dt.items.add(file)
    }
    filesRef.current.processFiles(dt.files)
  }, [])

  /**
   * On copy/cut, write a portable representation of the selection to the
   * clipboard. Portable resource chips (table/file/folder/etc.) become
   * `[label](sim:kind/id)` markdown links so they read cleanly anywhere AND
   * re-create their chip when pasted back into the input. Skill chips (whose
   * EM SPACE sentinel maps back to `/`) and `@integration` tokens stay readable
   * text and round-trip by name. Returns true when it took over the clipboard
   * (the caller must then perform the cut deletion itself, since the default
   * was prevented).
   */
  const writeSanitizedClipboard = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>): boolean => {
      const textarea = e.currentTarget
      const start = textarea.selectionStart ?? 0
      const end = textarea.selectionEnd ?? 0
      const selected = textarea.value.slice(start, end)
      if (!selected) return false
      const serialized = serializeSelectionForClipboard(
        selected,
        contextRef.current.selectedContexts
      )
      if (serialized === selected) return false
      e.preventDefault()
      e.clipboardData.setData('text/plain', serialized)
      return true
    },
    []
  )

  const handleCopy = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      writeSanitizedClipboard(e)
    },
    [writeSanitizedClipboard]
  )

  const handleCut = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      // When the selection holds a portable chip (skill or resource) we take over
      // the clipboard, so the selected text must be removed here (default prevented).
      // Either way the context-sync effect prunes contexts whose token is now gone.
      if (!writeSanitizedClipboard(e)) return
      const textarea = e.currentTarget
      const start = textarea.selectionStart ?? 0
      const end = textarea.selectionEnd ?? 0
      textarea.setRangeText('', start, end, 'end')
      valueRef.current = textarea.value
      setValue(textarea.value)
    },
    [writeSanitizedClipboard]
  )

  const overlayContent = useMemo(() => {
    const contexts = contextManagement.selectedContexts

    if (!value) {
      return <span>{'\u00A0'}</span>
    }

    if (contexts.length === 0) {
      const displayText = value.endsWith('\n') ? `${value}\u200B` : value
      return <span>{displayText}</span>
    }

    const tokens = extractContextTokens(contexts)
    const ranges = computeMentionHighlightRanges(value, tokens)

    if (ranges.length === 0) {
      const displayText = value.endsWith('\n') ? `${value}\u200B` : value
      return <span>{displayText}</span>
    }

    const elements: React.ReactNode[] = []
    let lastIndex = 0
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i]

      if (range.start > lastIndex) {
        const before = value.slice(lastIndex, range.start)
        elements.push(<span key={`text-${i}-${lastIndex}-${range.start}`}>{before}</span>)
      }

      const mentionLabel = stripMentionTrigger(range.token)
      const matchingCtx = contexts.find((c) => c.label === mentionLabel)

      const mentionIconNode = matchingCtx ? (
        <ContextMentionIcon
          context={matchingCtx}
          className='absolute inset-0 m-auto size-[12px] translate-y-[1.25px] text-[var(--text-icon)]'
        />
      ) : null

      elements.push(
        <span key={`mention-${i}-${range.start}-${range.end}`}>
          <span className='relative'>
            {/* Invisible trigger glyph keeps the overlay's advance identical to
                the transparent textarea; the icon centers over its slot. */}
            <span className='invisible'>{range.token.charAt(0)}</span>
            {mentionIconNode}
          </span>
          {mentionLabel}
        </span>
      )
      lastIndex = range.end
    }

    const tail = value.slice(lastIndex)
    if (tail) {
      const displayTail = tail.endsWith('\n') ? `${tail}\u200B` : tail
      elements.push(<span key={`tail-${lastIndex}`}>{displayTail}</span>)
    }

    return elements.length > 0 ? elements : <span>{'\u00A0'}</span>
  }, [value, contextManagement.selectedContexts])

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

      {/* Single scroller for textarea + overlay so they co-scroll natively;
          the sizer is sized by the full-height textarea, and the overlay fills
          it via `inset-0`. */}
      <div className={cn(SCROLLER_CLASSES, isInitialView ? 'max-h-[30vh]' : 'max-h-[200px]')}>
        <div className='relative'>
          <div className={OVERLAY_CLASSES} aria-hidden='true'>
            {overlayContent}
          </div>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onCopy={handleCopy}
            onCut={handleCut}
            onSelect={handleSelectAdjust}
            onMouseUp={handleSelectAdjust}
            placeholder='Ask Sim to '
            rows={1}
            className={TEXTAREA_BASE_CLASSES}
          />
        </div>
      </div>

      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-1'>
          <PlusMenuDropdown
            ref={plusMenuRef}
            availableResources={availableResources}
            onResourceSelect={handleResourceSelect}
            onClose={handlePlusMenuClose}
            textareaRef={textareaRef}
            pendingCursorRef={pendingCursorRef}
            mentionQuery={mentionQuery ?? undefined}
          />
          <SkillsMenuDropdown
            ref={skillsMenuRef}
            skills={skills}
            onSkillSelect={handleSkillSelect}
            onClose={handleSkillsMenuClose}
            textareaRef={textareaRef}
            pendingCursorRef={pendingCursorRef}
            slashQuery={slashQuery ?? undefined}
          />
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
