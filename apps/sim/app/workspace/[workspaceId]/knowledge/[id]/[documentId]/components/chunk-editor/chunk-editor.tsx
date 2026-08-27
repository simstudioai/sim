'use client'

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { handleKeyboardActivation, Label, Switch, toast } from '@sim/emcn'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { getKnowledgeChunkContract } from '@/lib/api/contracts/knowledge'
import type { ChunkData, DocumentData } from '@/lib/knowledge/types'
import { getAccurateTokenCount, getTokenStrings } from '@/lib/tokenization/accurate'
import { useCreateChunk, useUpdateChunk } from '@/hooks/queries/kb/knowledge'
import { useAutosave } from '@/hooks/use-autosave'

const TOKEN_BG_COLORS = [
  'rgba(239, 68, 68, 0.55)',
  'rgba(249, 115, 22, 0.55)',
  'rgba(234, 179, 8, 0.55)',
  'rgba(132, 204, 22, 0.55)',
  'rgba(34, 197, 94, 0.55)',
  'rgba(20, 184, 166, 0.55)',
  'rgba(6, 182, 212, 0.55)',
  'rgba(59, 130, 246, 0.55)',
  'rgba(139, 92, 246, 0.55)',
  'rgba(217, 70, 239, 0.55)',
] as const

/**
 * Collapsing to `auto` is what lets the box shrink, but it also drops the scroll range to zero
 * across the `scrollHeight` read, clamping the scroller to the top — so the offset is captured
 * and restored in the same frame.
 */
function syncTextareaHeight(textarea: HTMLTextAreaElement, scroller: HTMLElement) {
  const { scrollTop } = scroller
  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight}px`
  scroller.scrollTop = scrollTop
}

interface ChunkEditorProps {
  mode?: 'edit' | 'create'
  chunk?: ChunkData
  document: DocumentData
  knowledgeBaseId: string
  canEdit: boolean
  maxChunkSize?: number
  onDirtyChange: (isDirty: boolean) => void
  onSaveStatusChange?: (status: 'idle' | 'saving' | 'saved' | 'error') => void
  saveRef: React.MutableRefObject<(() => Promise<void>) | null>
  onCreated?: (chunkId: string) => void
}

export function ChunkEditor({
  mode = 'edit',
  chunk,
  document: documentData,
  knowledgeBaseId,
  canEdit,
  maxChunkSize,
  onDirtyChange,
  onSaveStatusChange,
  saveRef,
  onCreated,
}: ChunkEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const preservedScrollTopRef = useRef(0)
  const { mutateAsync: updateChunk } = useUpdateChunk()
  const { mutateAsync: createChunk } = useCreateChunk()

  const isCreateMode = mode === 'create'
  const chunkContent = chunk?.content ?? ''

  const [editedContent, setEditedContent] = useState(isCreateMode ? '' : chunkContent)
  const [savedContent, setSavedContent] = useState(chunkContent)
  const validationToastIdRef = useRef<string | null>(null)
  const [tokenizerOn, setTokenizerOn] = useState(false)
  const [hoveredTokenIndex, setHoveredTokenIndex] = useState<number | null>(null)
  const savedContentRef = useRef(chunkContent)

  const editedContentRef = useRef(editedContent)
  editedContentRef.current = editedContent

  useEffect(() => {
    if (isCreateMode || !chunk?.id) return
    const controller = new AbortController()
    const chunkId = chunk.id
    const handleVisibility = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const json = await requestJson(getKnowledgeChunkContract, {
          params: { id: knowledgeBaseId, documentId: documentData.id, chunkId },
          signal: controller.signal,
        })
        const serverContent = json.data.content ?? ''
        if (serverContent === savedContentRef.current) return
        const isClean = editedContentRef.current === savedContentRef.current
        savedContentRef.current = serverContent
        setSavedContent(serverContent)
        if (isClean) {
          setEditedContent(serverContent)
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        if (isApiClientError(err)) return
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      controller.abort()
    }
  }, [isCreateMode, chunk?.id, knowledgeBaseId, documentData.id])

  useEffect(() => {
    if (isCreateMode && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isCreateMode])

  const isConnectorDocument = Boolean(documentData.connectorId)

  const handleSave = useCallback(async () => {
    const content = editedContentRef.current
    const trimmed = content.trim()
    /** Toast every failed attempt, replacing the previous validation toast so retries refresh instead of stack. */
    const failValidation = (message: string): never => {
      if (validationToastIdRef.current) toast.dismiss(validationToastIdRef.current)
      validationToastIdRef.current = toast.error(message)
      throw new Error(message)
    }
    if (trimmed.length === 0) failValidation('Content cannot be empty')
    if (trimmed.length > 10000) failValidation('Content exceeds maximum length (10,000 characters)')
    if (validationToastIdRef.current) {
      toast.dismiss(validationToastIdRef.current)
      validationToastIdRef.current = null
    }

    if (isCreateMode) {
      const created = await createChunk({
        knowledgeBaseId,
        documentId: documentData.id,
        content: trimmed,
        enabled: true,
      })
      onCreated?.(created.id)
    } else {
      if (!chunk?.id) return
      await updateChunk({
        knowledgeBaseId,
        documentId: documentData.id,
        chunkId: chunk.id,
        content: trimmed,
      })
      savedContentRef.current = content
      setSavedContent(content)
    }
  }, [
    isCreateMode,
    chunk?.id,
    knowledgeBaseId,
    documentData.id,
    updateChunk,
    createChunk,
    onCreated,
  ])

  const {
    saveStatus,
    saveImmediately,
    isDirty: autosaveDirty,
  } = useAutosave({
    content: editedContent,
    savedContent,
    onSave: handleSave,
    enabled: canEdit && !isCreateMode && !isConnectorDocument,
  })

  const isDirty = isCreateMode ? editedContent.trim().length > 0 : autosaveDirty

  useEffect(() => {
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])

  useEffect(() => {
    onSaveStatusChange?.(saveStatus)
  }, [saveStatus, onSaveStatusChange])

  const saveFunction = isCreateMode ? handleSave : saveImmediately

  if (saveRef) saveRef.current = saveFunction
  useEffect(
    () => () => {
      if (saveRef) saveRef.current = null
    },
    [saveRef]
  )

  const handleTokenizerChange = useCallback((value: boolean) => {
    preservedScrollTopRef.current = scrollRef.current?.scrollTop ?? 0
    setTokenizerOn(value)
  }, [])

  /**
   * The textarea's height is synced to its content so the surrounding container owns the only
   * scrollbar, as in the rich markdown editor.
   */
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    const scroller = scrollRef.current
    if (!textarea || !scroller) return
    syncTextareaHeight(textarea, scroller)
  }, [editedContent, tokenizerOn])

  /**
   * The box is `overflow-hidden`, so a width change that re-wraps lines without touching the
   * content would clip the tail with no scrollbar to reach it. The scroller is observed rather
   * than the textarea because it supplies the width without being the element the callback resizes.
   */
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    const scroller = scrollRef.current
    if (!textarea || !scroller) return
    const observer = new ResizeObserver(() => syncTextareaHeight(textarea, scroller))
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [tokenizerOn])

  /** Must run after the measure above, which establishes the scroll range this offset needs. */
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = preservedScrollTopRef.current
  }, [tokenizerOn])

  const tokenStrings = useMemo(() => {
    if (!tokenizerOn || !editedContent) return []
    return getTokenStrings(editedContent)
  }, [editedContent, tokenizerOn])

  const tokenCount = useMemo(() => {
    if (!editedContent) return 0
    if (tokenizerOn) return tokenStrings.length
    return getAccurateTokenCount(editedContent)
  }, [editedContent, tokenizerOn, tokenStrings])

  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      <div
        ref={scrollRef}
        role='group'
        aria-label='Chunk content editor'
        className='min-h-0 flex-1 cursor-text overflow-y-auto [scrollbar-gutter:stable_both-edges]'
        onClick={(e) => {
          if (e.target === e.currentTarget) textareaRef.current?.focus()
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          handleKeyboardActivation(event, () => textareaRef.current?.focus())
        }}
      >
        {tokenizerOn ? (
          <div className='mx-auto min-h-full w-full max-w-[48rem] cursor-default whitespace-pre-wrap break-words px-8 py-6 font-sans text-[var(--text-body)] text-sm'>
            {tokenStrings.map((token, index) => (
              <span
                key={index}
                style={{ backgroundColor: TOKEN_BG_COLORS[index % TOKEN_BG_COLORS.length] }}
                onMouseEnter={() => setHoveredTokenIndex(index)}
                onMouseLeave={() => setHoveredTokenIndex(null)}
              >
                {token}
              </span>
            ))}
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            placeholder={
              isCreateMode
                ? 'Enter the content for this chunk...'
                : canEdit
                  ? 'Enter chunk content...'
                  : isConnectorDocument
                    ? 'This chunk is synced from a connector and cannot be edited'
                    : 'Read-only view'
            }
            className='mx-auto block min-h-full w-full max-w-[48rem] resize-none overflow-hidden border-0 bg-transparent px-8 py-6 font-sans text-[var(--text-body)] text-sm outline-none placeholder:text-[var(--text-subtle)]'
            disabled={!canEdit}
            readOnly={!canEdit}
            spellCheck={false}
          />
        )}
      </div>
      <div className='flex shrink-0 items-center justify-between border-[var(--border)] border-t px-6 py-2.5'>
        <TokenizerToggle
          checked={tokenizerOn}
          onCheckedChange={handleTokenizerChange}
          hoveredTokenIndex={tokenizerOn ? hoveredTokenIndex : null}
        />
        <span className='text-[var(--text-secondary)] text-caption'>
          {tokenCount.toLocaleString()}
          {maxChunkSize !== undefined && `/${maxChunkSize.toLocaleString()}`} tokens
        </span>
      </div>
    </div>
  )
}

const TokenizerToggle = React.memo(function TokenizerToggle({
  checked,
  onCheckedChange,
  hoveredTokenIndex,
}: {
  checked: boolean
  onCheckedChange: (value: boolean) => void
  hoveredTokenIndex: number | null
}) {
  return (
    <div className='flex items-center gap-2'>
      <Label className='text-[var(--text-secondary)] text-caption'>Tokenizer</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
      {checked && hoveredTokenIndex !== null && (
        <span className='text-[var(--text-tertiary)] text-caption'>
          Token #{hoveredTokenIndex + 1}
        </span>
      )}
    </div>
  )
})
