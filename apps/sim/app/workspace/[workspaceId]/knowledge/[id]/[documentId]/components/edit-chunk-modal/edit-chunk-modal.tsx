'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ChevronDown, ChevronUp } from 'lucide-react'
import {
  Button,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Switch,
  Textarea,
  Tooltip,
} from '@/components/emcn'
import type { ChunkData, DocumentData } from '@/lib/knowledge/types'
import { getAccurateTokenCount, getTokenStrings } from '@/lib/tokenization/estimators'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useUpdateChunk } from '@/hooks/queries/knowledge'

const logger = createLogger('EditChunkModal')

interface EditChunkModalProps {
  chunk: ChunkData | null
  document: DocumentData | null
  knowledgeBaseId: string
  isOpen: boolean
  onClose: () => void
  allChunks?: ChunkData[]
  currentPage?: number
  totalPages?: number
  onNavigateToChunk?: (chunk: ChunkData) => void
  onNavigateToPage?: (page: number, selectChunk: 'first' | 'last') => Promise<void>
  maxChunkSize?: number
}

export function EditChunkModal({
  chunk,
  document,
  knowledgeBaseId,
  isOpen,
  onClose,
  allChunks = [],
  currentPage = 1,
  totalPages = 1,
  onNavigateToChunk,
  onNavigateToPage,
  maxChunkSize,
}: EditChunkModalProps) {
  const userPermissions = useUserPermissionsContext()
  const {
    mutate: updateChunk,
    isPending: isSaving,
    error: mutationError,
    reset: resetMutation,
  } = useUpdateChunk()
  const [editedContent, setEditedContent] = useState(chunk?.content || '')
  const [isNavigating, setIsNavigating] = useState(false)
  const [showUnsavedChangesAlert, setShowUnsavedChangesAlert] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null)
  const [tokenizerOn, setTokenizerOn] = useState(false)
  const [hoveredTokenIndex, setHoveredTokenIndex] = useState<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const error = mutationError?.message ?? null

  const hasUnsavedChanges = editedContent !== (chunk?.content || '')

  const tokenStrings = useMemo(() => {
    if (!tokenizerOn || !editedContent) return []
    return getTokenStrings(editedContent)
  }, [editedContent, tokenizerOn])

  const tokenCount = useMemo(() => {
    if (!editedContent) return 0
    if (tokenizerOn) return tokenStrings.length
    return getAccurateTokenCount(editedContent)
  }, [editedContent, tokenizerOn, tokenStrings])

  const TOKEN_BG_COLORS = [
    'rgba(239, 68, 68, 0.55)', // Red
    'rgba(249, 115, 22, 0.55)', // Orange
    'rgba(234, 179, 8, 0.55)', // Yellow
    'rgba(132, 204, 22, 0.55)', // Lime
    'rgba(34, 197, 94, 0.55)', // Green
    'rgba(20, 184, 166, 0.55)', // Teal
    'rgba(6, 182, 212, 0.55)', // Cyan
    'rgba(59, 130, 246, 0.55)', // Blue
    'rgba(139, 92, 246, 0.55)', // Violet
    'rgba(217, 70, 239, 0.55)', // Fuchsia
  ]

  const getTokenBgColor = (index: number): string => {
    return TOKEN_BG_COLORS[index % TOKEN_BG_COLORS.length]
  }

  useEffect(() => {
    if (chunk?.content) {
      setEditedContent(chunk.content)
    }
  }, [chunk?.id, chunk?.content])

  const currentChunkIndex = chunk ? allChunks.findIndex((c) => c.id === chunk.id) : -1

  const canNavigatePrev = currentChunkIndex > 0 || currentPage > 1
  const canNavigateNext = currentChunkIndex < allChunks.length - 1 || currentPage < totalPages

  const handleSaveContent = () => {
    if (!chunk || !document) return

    updateChunk({
      knowledgeBaseId,
      documentId: document.id,
      chunkId: chunk.id,
      content: editedContent,
    })
  }

  const navigateToChunk = async (direction: 'prev' | 'next') => {
    if (!chunk || isNavigating) return

    try {
      setIsNavigating(true)

      if (direction === 'prev') {
        if (currentChunkIndex > 0) {
          const prevChunk = allChunks[currentChunkIndex - 1]
          onNavigateToChunk?.(prevChunk)
        } else if (currentPage > 1) {
          await onNavigateToPage?.(currentPage - 1, 'last')
        }
      } else {
        if (currentChunkIndex < allChunks.length - 1) {
          const nextChunk = allChunks[currentChunkIndex + 1]
          onNavigateToChunk?.(nextChunk)
        } else if (currentPage < totalPages) {
          await onNavigateToPage?.(currentPage + 1, 'first')
        }
      }
    } catch (err) {
      logger.error(`Error navigating ${direction}:`, err)
    } finally {
      setIsNavigating(false)
    }
  }

  const handleNavigate = (direction: 'prev' | 'next') => {
    if (hasUnsavedChanges) {
      setPendingNavigation(() => () => navigateToChunk(direction))
      setShowUnsavedChangesAlert(true)
    } else {
      void navigateToChunk(direction)
    }
  }

  const handleCloseAttempt = () => {
    if (hasUnsavedChanges && !isSaving) {
      setPendingNavigation(null)
      setShowUnsavedChangesAlert(true)
    } else {
      resetMutation()
      onClose()
    }
  }

  const handleConfirmDiscard = () => {
    setShowUnsavedChangesAlert(false)
    if (pendingNavigation) {
      void pendingNavigation()
      setPendingNavigation(null)
    } else {
      resetMutation()
      onClose()
    }
  }

  const isFormValid = editedContent.trim().length > 0 && editedContent.trim().length <= 10000

  if (!chunk || !document) return null

  return (
    <>
      <Modal open={isOpen} onOpenChange={handleCloseAttempt}>
        <ModalContent size='lg'>
          <ModalHeader>
            <div className='flex items-center gap-[8px]'>
              <span>Edit Chunk #{chunk.chunkIndex}</span>
              {/* Navigation Controls */}
              <div className='flex items-center gap-[6px]'>
                <Tooltip.Root>
                  <Tooltip.Trigger
                    asChild
                    onFocus={(e) => e.preventDefault()}
                    onBlur={(e) => e.preventDefault()}
                  >
                    <Button
                      variant='ghost'
                      onClick={() => handleNavigate('prev')}
                      disabled={!canNavigatePrev || isNavigating || isSaving}
                      className='h-[16px] w-[16px] p-0'
                    >
                      <ChevronUp className='h-[16px] w-[16px]' />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='bottom'>
                    Previous chunk{' '}
                    {currentPage > 1 && currentChunkIndex === 0 ? '(previous page)' : ''}
                  </Tooltip.Content>
                </Tooltip.Root>

                <Tooltip.Root>
                  <Tooltip.Trigger
                    asChild
                    onFocus={(e) => e.preventDefault()}
                    onBlur={(e) => e.preventDefault()}
                  >
                    <Button
                      variant='ghost'
                      onClick={() => handleNavigate('next')}
                      disabled={!canNavigateNext || isNavigating || isSaving}
                      className='h-[16px] w-[16px] p-0'
                    >
                      <ChevronDown className='h-[16px] w-[16px]' />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='bottom'>
                    Next chunk{' '}
                    {currentPage < totalPages && currentChunkIndex === allChunks.length - 1
                      ? '(next page)'
                      : ''}
                  </Tooltip.Content>
                </Tooltip.Root>
              </div>
            </div>
          </ModalHeader>

          <form>
            <ModalBody>
              <div className='flex flex-col gap-[8px]'>
                {error && <p className='text-[12px] text-[var(--text-error)]'>{error}</p>}

                {/* Content Input Section */}
                <Label htmlFor='content'>Chunk</Label>
                {tokenizerOn ? (
                  /* Tokenizer view - matches Textarea styling exactly (transparent border for spacing) */
                  <div
                    className='h-[418px] overflow-y-auto whitespace-pre-wrap break-words rounded-[4px] border border-transparent bg-[var(--surface-5)] px-[8px] py-[8px] font-medium font-sans text-[var(--text-primary)] text-sm'
                    style={{ minHeight: '418px' }}
                  >
                    {tokenStrings.map((token, index) => (
                      <span
                        key={index}
                        style={{
                          backgroundColor: getTokenBgColor(index),
                        }}
                        onMouseEnter={() => setHoveredTokenIndex(index)}
                        onMouseLeave={() => setHoveredTokenIndex(null)}
                      >
                        {token}
                      </span>
                    ))}
                  </div>
                ) : (
                  /* Edit view - regular textarea */
                  <Textarea
                    ref={textareaRef}
                    id='content'
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    placeholder={
                      userPermissions.canEdit ? 'Enter chunk content...' : 'Read-only view'
                    }
                    rows={20}
                    disabled={isSaving || isNavigating || !userPermissions.canEdit}
                    readOnly={!userPermissions.canEdit}
                  />
                )}
              </div>

              {/* Tokenizer Section */}
              <div className='flex items-center justify-between pt-[12px]'>
                <div className='flex items-center gap-[8px]'>
                  <span className='text-[12px] text-[var(--text-secondary)]'>Tokenizer</span>
                  <Switch checked={tokenizerOn} onCheckedChange={setTokenizerOn} />
                  {tokenizerOn && hoveredTokenIndex !== null && (
                    <span className='text-[12px] text-[var(--text-tertiary)]'>
                      Token #{hoveredTokenIndex + 1}
                    </span>
                  )}
                </div>
                <span className='text-[12px] text-[var(--text-secondary)]'>
                  {tokenCount.toLocaleString()}
                  {maxChunkSize !== undefined && `/${maxChunkSize.toLocaleString()}`} tokens
                </span>
              </div>
            </ModalBody>

            <ModalFooter>
              <Button
                variant='default'
                onClick={handleCloseAttempt}
                type='button'
                disabled={isSaving || isNavigating}
              >
                Cancel
              </Button>
              {userPermissions.canEdit && (
                <Button
                  variant='tertiary'
                  onClick={handleSaveContent}
                  type='button'
                  disabled={!isFormValid || isSaving || !hasUnsavedChanges || isNavigating}
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
              )}
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      {/* Unsaved Changes Alert */}
      <Modal open={showUnsavedChangesAlert} onOpenChange={setShowUnsavedChangesAlert}>
        <ModalContent size='sm'>
          <ModalHeader>Unsaved Changes</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              You have unsaved changes to this chunk content.
              {pendingNavigation
                ? ' Do you want to discard your changes and navigate to the next chunk?'
                : ' Are you sure you want to discard your changes and close the editor?'}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={() => {
                setShowUnsavedChangesAlert(false)
                setPendingNavigation(null)
              }}
              type='button'
            >
              Keep Editing
            </Button>
            <Button variant='destructive' onClick={handleConfirmDiscard} type='button'>
              Discard Changes
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
