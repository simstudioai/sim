'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Label, Switch } from '@/components/emcn'
import type { ChunkData, DocumentData } from '@/lib/knowledge/types'
import { getAccurateTokenCount, getTokenStrings } from '@/lib/tokenization/estimators'
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
  const { mutateAsync: updateChunk } = useUpdateChunk()
  const { mutateAsync: createChunk } = useCreateChunk()

  const isCreateMode = mode === 'create'
  const chunkContent = chunk?.content ?? ''

  const [editedContent, setEditedContent] = useState(isCreateMode ? '' : chunkContent)
  const [savedContent, setSavedContent] = useState(chunkContent)
  const [tokenizerOn, setTokenizerOn] = useState(false)
  const [hoveredTokenIndex, setHoveredTokenIndex] = useState<number | null>(null)
  const prevChunkIdRef = useRef(chunk?.id)
  const savedContentRef = useRef(chunkContent)

  const editedContentRef = useRef(editedContent)
  editedContentRef.current = editedContent

  useEffect(() => {
    if (isCreateMode) return
    if (chunk?.id !== prevChunkIdRef.current) {
      prevChunkIdRef.current = chunk?.id
      savedContentRef.current = chunkContent
      setSavedContent(chunkContent)
      setEditedContent(chunkContent)
    }
  }, [isCreateMode, chunk?.id, chunkContent])

  useEffect(() => {
    if (isCreateMode || !chunk?.id) return
    const controller = new AbortController()
    const handleVisibility = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const res = await fetch(
          `/api/knowledge/${knowledgeBaseId}/documents/${documentData.id}/chunks/${chunk.id}`,
          { signal: controller.signal }
        )
        if (!res.ok) return
        const json = await res.json()
        const serverContent: string = json.data?.content ?? ''
        if (serverContent === savedContentRef.current) return
        const isClean = editedContentRef.current === savedContentRef.current
        savedContentRef.current = serverContent
        setSavedContent(serverContent)
        if (isClean) {
          setEditedContent(serverContent)
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
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
    if (trimmed.length === 0) throw new Error('Content cannot be empty')
    if (trimmed.length > 10000) throw new Error('Content exceeds maximum length')

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
        className='flex min-h-0 flex-1 cursor-text overflow-hidden'
        onClick={(e) => {
          if (e.target === e.currentTarget) textareaRef.current?.focus()
        }}
      >
        {tokenizerOn ? (
          <div className='h-full w-full cursor-default overflow-y-auto whitespace-pre-wrap break-words p-[24px] font-sans text-[14px] text-[var(--text-body)]'>
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
            className='min-h-0 flex-1 resize-none border-0 bg-transparent p-[24px] font-sans text-[14px] text-[var(--text-body)] outline-none placeholder:text-[var(--text-subtle)]'
            disabled={!canEdit}
            readOnly={!canEdit}
            spellCheck={false}
          />
        )}
      </div>
      <div className='flex items-center justify-between border-[var(--border)] border-t px-[24px] py-[10px]'>
        <TokenizerToggle
          checked={tokenizerOn}
          onCheckedChange={setTokenizerOn}
          hoveredTokenIndex={tokenizerOn ? hoveredTokenIndex : null}
        />
        <span className='text-[12px] text-[var(--text-secondary)]'>
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
    <div className='flex items-center gap-[8px]'>
      <Label className='text-[12px] text-[var(--text-secondary)]'>Tokenizer</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
      {checked && hoveredTokenIndex !== null && (
        <span className='text-[12px] text-[var(--text-tertiary)]'>
          Token #{hoveredTokenIndex + 1}
        </span>
      )}
    </div>
  )
})
