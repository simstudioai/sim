'use client'

import type React from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Database, Table as TableIcon } from '@/components/emcn/icons'
import { getDocumentIcon } from '@/components/icons/document-icons'
import { useSession } from '@/lib/auth/auth-client'
import { cn } from '@/lib/core/utils/cn'
import { CHAT_ACCEPT_ATTRIBUTE } from '@/lib/uploads/utils/validation'
import { useAvailableResources } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown'
import type {
  PlusMenuHandle,
  SpeechRecognitionErrorEvent,
  SpeechRecognitionEvent,
  SpeechRecognitionInstance,
  WindowWithSpeech,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components'
import {
  AnimatedPlaceholderEffect,
  AttachedFilesList,
  autoResizeTextarea,
  DropOverlay,
  MAX_CHAT_TEXTAREA_HEIGHT,
  MicButton,
  mapResourceToContext,
  OVERLAY_CLASSES,
  PlusMenuDropdown,
  SendButton,
  SPEECH_RECOGNITION_LANG,
  TEXTAREA_BASE_CLASSES,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components'
import type {
  FileAttachmentForApi,
  MothershipResource,
} from '@/app/workspace/[workspaceId]/home/types'
import {
  useContextManagement,
  useFileAttachments,
  useMentionMenu,
  useMentionTokens,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks'
import type { AttachedFile } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'
import {
  computeMentionHighlightRanges,
  extractContextTokens,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'
import { useWorkflowMap } from '@/hooks/queries/workflows'
import type { ChatContext } from '@/stores/panel'

export type { FileAttachmentForApi } from '@/app/workspace/[workspaceId]/home/types'

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
  editValue?: string
  onEditValueConsumed?: () => void
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
}

export function UserInput({
  defaultValue = '',
  editValue,
  onEditValueConsumed,
  onSubmit,
  isSending,
  onStopGeneration,
  isInitialView = true,
  userId,
  onContextAdd,
}: UserInputProps) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { data: workflowsById = {} } = useWorkflowMap(workspaceId)
  const { data: session } = useSession()
  const [value, setValue] = useState(defaultValue)
  const overlayRef = useRef<HTMLDivElement>(null)
  const plusMenuRef = useRef<PlusMenuHandle>(null)

  const [prevDefaultValue, setPrevDefaultValue] = useState(defaultValue)
  if (defaultValue && defaultValue !== prevDefaultValue) {
    setPrevDefaultValue(defaultValue)
    setValue(defaultValue)
  } else if (!defaultValue && prevDefaultValue) {
    setPrevDefaultValue(defaultValue)
  }

  const [prevEditValue, setPrevEditValue] = useState(editValue)
  if (editValue && editValue !== prevEditValue) {
    setPrevEditValue(editValue)
    setValue(editValue)
  } else if (!editValue && prevEditValue) {
    setPrevEditValue(editValue)
  }

  useEffect(() => {
    if (editValue) onEditValueConsumed?.()
  }, [editValue, onEditValueConsumed])

  const files = useFileAttachments({
    userId: userId || session?.user?.id,
    workspaceId,
    disabled: false,
    isLoading: isSending,
  })
  const hasFiles = files.attachedFiles.some((f) => !f.uploading && f.key)

  const contextManagement = useContextManagement({ message: value })

  const { addContext } = contextManagement

  const handleContextAdd = useCallback(
    (context: ChatContext) => {
      addContext(context)
      onContextAdd?.(context)
    },
    [addContext, onContextAdd]
  )

  const existingResourceKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const ctx of contextManagement.selectedContexts) {
      if (ctx.kind === 'workflow' && ctx.workflowId) keys.add(`workflow:${ctx.workflowId}`)
      if (ctx.kind === 'knowledge' && ctx.knowledgeId) keys.add(`knowledgebase:${ctx.knowledgeId}`)
      if (ctx.kind === 'table' && ctx.tableId) keys.add(`table:${ctx.tableId}`)
      if (ctx.kind === 'file' && ctx.fileId) keys.add(`file:${ctx.fileId}`)
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
    setSelectedContexts: contextManagement.setSelectedContexts,
  })

  const canSubmit = (value.trim().length > 0 || hasFiles) && !isSending

  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const prefixRef = useRef('')
  const valueRef = useRef(value)

  const filesRef = useRef(files)
  filesRef.current = files
  const contextRef = useRef(contextManagement)
  contextRef.current = contextManagement

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    valueRef.current = value
  }, [value])

  const textareaRef = mentionMenu.textareaRef
  const wasSendingRef = useRef(false)
  const atInsertPosRef = useRef<number | null>(null)
  const pendingCursorRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const maxHeight = isInitialView ? window.innerHeight * 0.3 : MAX_CHAT_TEXTAREA_HEIGHT
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
    if (overlayRef.current) {
      overlayRef.current.scrollTop = textarea.scrollTop
    }
  }, [value, isInitialView, textareaRef])

  const handleResourceSelect = useCallback(
    (resource: MothershipResource) => {
      const textarea = textareaRef.current
      if (textarea) {
        const currentValue = valueRef.current
        const insertAt = atInsertPosRef.current ?? textarea.selectionStart ?? currentValue.length
        atInsertPosRef.current = null

        const needsSpaceBefore = insertAt > 0 && !/\s/.test(currentValue.charAt(insertAt - 1))
        const insertText = `${needsSpaceBefore ? ' ' : ''}@${resource.title} `
        const before = currentValue.slice(0, insertAt)
        const after = currentValue.slice(insertAt)
        const newPos = before.length + insertText.length
        pendingCursorRef.current = newPos
        setValue(`${before}${insertText}${after}`)
      }

      const context = mapResourceToContext(resource)
      handleContextAdd(context)
    },
    [textareaRef, handleContextAdd]
  )

  const handlePlusMenuClose = useCallback(() => {
    atInsertPosRef.current = null
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
    if (e.dataTransfer.types.includes('application/x-sim-resource')) {
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
      return
    }
    filesRef.current.handleDragOver(e)
  }, [])

  const handleContainerDrop = useCallback(
    (e: React.DragEvent) => {
      const resourceJson = e.dataTransfer.getData('application/x-sim-resource')
      if (resourceJson) {
        e.preventDefault()
        e.stopPropagation()
        try {
          const resource = JSON.parse(resourceJson) as MothershipResource
          handleResourceSelect(resource)
        } catch {
          // Invalid JSON — ignore
        }
        return
      }
      filesRef.current.handleDrop(e)
    },
    [handleResourceSelect]
  )

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    filesRef.current.handleDragEnter(e)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    filesRef.current.handleDragLeave(e)
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    filesRef.current.handleFileChange(e)
  }, [])

  useEffect(() => {
    if (wasSendingRef.current && !isSending) {
      textareaRef.current?.focus()
    }
    wasSendingRef.current = isSending
  }, [isSending, textareaRef])

  useEffect(() => {
    if (isInitialView) {
      textareaRef.current?.focus()
    }
  }, [isInitialView, textareaRef])

  const handleContainerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('button')) return
      textareaRef.current?.focus()
    },
    [textareaRef]
  )

  const startRecognition = useCallback((): boolean => {
    const w = window as WindowWithSpeech
    const SpeechRecognitionAPI = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!SpeechRecognitionAPI) return false

    const recognition = new SpeechRecognitionAPI()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = SPEECH_RECOGNITION_LANG

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = ''
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      const prefix = prefixRef.current
      const newVal = prefix ? `${prefix} ${transcript}` : transcript
      setValue(newVal)
      valueRef.current = newVal
    }

    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        prefixRef.current = valueRef.current
        try {
          recognition.start()
        } catch {
          recognitionRef.current = null
          setIsListening(false)
        }
      }
    }

    recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (recognitionRef.current !== recognition) return
      if (e.error === 'aborted' || e.error === 'not-allowed') {
        recognitionRef.current = null
        setIsListening(false)
      }
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      return true
    } catch {
      recognitionRef.current = null
      return false
    }
  }, [])

  const restartRecognition = useCallback(
    (newPrefix: string) => {
      if (!recognitionRef.current) return
      prefixRef.current = newPrefix
      recognitionRef.current.abort()
      recognitionRef.current = null
      if (!startRecognition()) {
        setIsListening(false)
      }
    },
    [startRecognition]
  )

  const toggleListening = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop()
      recognitionRef.current = null
      setIsListening(false)
      return
    }

    prefixRef.current = valueRef.current
    if (startRecognition()) {
      setIsListening(true)
    }
  }, [isListening, startRecognition])

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
      }))

    onSubmit(
      currentValue,
      fileAttachmentsForApi.length > 0 ? fileAttachmentsForApi : undefined,
      currentContext.selectedContexts.length > 0 ? currentContext.selectedContexts : undefined
    )
    setValue('')
    restartRecognition('')
    currentFiles.clearAttachedFiles()
    currentContext.clearContexts()

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [onSubmit, restartRecognition, textareaRef])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        handleSubmit()
        return
      }

      const textarea = textareaRef.current
      const selStart = textarea?.selectionStart ?? 0
      const selEnd = textarea?.selectionEnd ?? selStart
      const selectionLength = Math.abs(selEnd - selStart)

      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selectionLength > 0) {
          mentionTokensWithContext.removeContextsInSelection(selStart, selEnd)
        } else {
          const ranges = mentionTokensWithContext.computeMentionRanges()
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
      }

      if (selectionLength === 0 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
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

      if (e.key.length === 1 || e.key === 'Space') {
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

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      const caret = e.target.selectionStart ?? newValue.length

      if (
        caret > 0 &&
        newValue.charAt(caret - 1) === '@' &&
        (caret === 1 || /\s/.test(newValue.charAt(caret - 2)))
      ) {
        const before = newValue.slice(0, caret - 1)
        const after = newValue.slice(caret)
        const adjusted = `${before}${after}`
        setValue(adjusted)
        atInsertPosRef.current = caret - 1
        const anchor = getCaretAnchor(e.target, caret - 1)
        plusMenuRef.current?.open(anchor)
        restartRecognition(adjusted)
        return
      }

      setValue(newValue)
      restartRecognition(newValue)
    },
    [restartRecognition]
  )

  const handleSelectAdjust = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const pos = textarea.selectionStart ?? 0
    const r = mentionTokensWithContext.findRangeContaining(pos)
    if (r) {
      const snapPos = pos - r.start < r.end - pos ? r.start : r.end
      setTimeout(() => {
        textarea.setSelectionRange(snapPos, snapPos)
      }, 0)
    }
  }, [textareaRef, mentionTokensWithContext])

  const handleInput = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement>) => {
      const maxHeight = isInitialView ? window.innerHeight * 0.3 : MAX_CHAT_TEXTAREA_HEIGHT
      autoResizeTextarea(e, maxHeight)

      if (overlayRef.current) {
        overlayRef.current.scrollTop = (e.target as HTMLTextAreaElement).scrollTop
      }
    },
    [isInitialView]
  )

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
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

  const handleScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    if (overlayRef.current) {
      overlayRef.current.scrollTop = e.currentTarget.scrollTop
    }
  }, [])

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

      const mentionLabel =
        range.token.startsWith('@') || range.token.startsWith('/')
          ? range.token.slice(1)
          : range.token
      const matchingCtx = contexts.find((c) => c.label === mentionLabel)

      let mentionIconNode: React.ReactNode = null
      if (matchingCtx) {
        const iconClasses = 'absolute inset-0 m-auto h-[12px] w-[12px] text-[var(--text-icon)]'
        switch (matchingCtx.kind) {
          case 'workflow':
          case 'current_workflow': {
            const wfId = (matchingCtx as { workflowId: string }).workflowId
            const wfColor = workflowsById[wfId]?.color ?? '#888'
            mentionIconNode = (
              <div
                className='absolute inset-0 m-auto h-[12px] w-[12px] rounded-[3px] border-[2px]'
                style={{
                  backgroundColor: wfColor,
                  borderColor: `${wfColor}60`,
                  backgroundClip: 'padding-box',
                }}
              />
            )
            break
          }
          case 'knowledge':
            mentionIconNode = <Database className={iconClasses} />
            break
          case 'table':
            mentionIconNode = <TableIcon className={iconClasses} />
            break
          case 'file': {
            const FileDocIcon = getDocumentIcon('', mentionLabel)
            mentionIconNode = <FileDocIcon className={iconClasses} />
            break
          }
        }
      }

      elements.push(
        <span
          key={`mention-${i}-${range.start}-${range.end}`}
          className='rounded-[5px] bg-[var(--surface-5)] py-0.5'
          style={{
            boxShadow: '-2px 0 0 var(--surface-5), 2px 0 0 var(--surface-5)',
          }}
        >
          <span className='relative'>
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
  }, [value, contextManagement.selectedContexts, workflowsById])

  return (
    <div
      onClick={handleContainerClick}
      className={cn(
        'relative z-10 mx-auto w-full max-w-[42rem] cursor-text rounded-[20px] border border-[var(--border-1)] bg-[var(--white)] px-2.5 py-2 dark:bg-[var(--surface-4)]',
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

      <div className='relative'>
        <div
          ref={overlayRef}
          className={cn(OVERLAY_CLASSES, isInitialView ? 'max-h-[30vh]' : 'max-h-[200px]')}
          aria-hidden='true'
        >
          {overlayContent}
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onPaste={handlePaste}
          onCut={mentionTokensWithContext.handleCut}
          onSelect={handleSelectAdjust}
          onMouseUp={handleSelectAdjust}
          onScroll={handleScroll}
          placeholder=''
          rows={1}
          className={cn(TEXTAREA_BASE_CLASSES, isInitialView ? 'max-h-[30vh]' : 'max-h-[200px]')}
        />
      </div>

      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-1.5'>
          <PlusMenuDropdown
            ref={plusMenuRef}
            availableResources={availableResources}
            onResourceSelect={handleResourceSelect}
            onFileSelect={handleFileSelectStable}
            onClose={handlePlusMenuClose}
            textareaRef={textareaRef}
            pendingCursorRef={pendingCursorRef}
          />
        </div>
        <div className='flex items-center gap-1.5'>
          <MicButton isListening={isListening} onToggle={toggleListening} />
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
}
