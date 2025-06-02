'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface ChunkData {
  id: string
  chunkIndex: number
  content: string
  contentLength: number
  tokenCount: number
  enabled: boolean
  startOffset: number
  endOffset: number
  overlapTokens: number
  metadata: any
  searchRank: string
  qualityScore: string | null
  createdAt: string
  updatedAt: string
}

interface DocumentData {
  id: string
  knowledgeBaseId: string
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
  fileHash?: string
  chunkCount: number
  tokenCount: number
  characterCount: number
  enabled: boolean
  uploadedAt: string
}

interface EditChunkModalProps {
  chunk: ChunkData | null
  document: DocumentData | null
  knowledgeBaseId: string
  isOpen: boolean
  onClose: () => void
  onChunkUpdate?: (updatedChunk: ChunkData) => void
}

export function EditChunkModal({
  chunk,
  document,
  knowledgeBaseId,
  isOpen,
  onClose,
  onChunkUpdate,
}: EditChunkModalProps) {
  const [editedContent, setEditedContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // Update edited content when chunk changes
  useEffect(() => {
    if (chunk?.content) {
      setEditedContent(chunk.content)
    }
  }, [chunk?.id, chunk?.content])

  const handleSaveContent = async () => {
    if (!chunk || !document) return

    try {
      setIsSaving(true)

      const response = await fetch(
        `/api/knowledge/${knowledgeBaseId}/documents/${document.id}/chunks/${chunk.id}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: editedContent,
          }),
        }
      )

      if (!response.ok) {
        throw new Error('Failed to update chunk')
      }

      const result = await response.json()

      if (result.success && onChunkUpdate) {
        onChunkUpdate(result.data)
        onClose()
      }
    } catch (error) {
      console.error('Error updating chunk:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setEditedContent(chunk?.content || '')
    onClose()
  }

  if (!chunk || !document) return null

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className='flex h-[74vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]'
        hideCloseButton
      >
        <DialogHeader className='flex-shrink-0 border-b px-6 py-4'>
          <div className='flex items-center justify-between'>
            <DialogTitle className='font-medium text-lg'>Edit Chunk Content</DialogTitle>
            <Button variant='ghost' size='icon' className='h-8 w-8 p-0' onClick={onClose}>
              <X className='h-4 w-4' />
              <span className='sr-only'>Close</span>
            </Button>
          </div>
        </DialogHeader>

        <div className='flex flex-1 flex-col overflow-hidden'>
          <form className='flex h-full flex-col'>
            {/* Scrollable Content */}
            <div className='scrollbar-thin scrollbar-thumb-muted-foreground/20 hover:scrollbar-thumb-muted-foreground/25 scrollbar-track-transparent min-h-0 flex-1 overflow-y-auto px-6'>
              <div className='py-4'>
                <div className='space-y-2'>
                  <Label htmlFor='content'>Content</Label>
                  <Textarea
                    id='content'
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    placeholder='Enter chunk content...'
                    className='min-h-[400px] resize-none'
                  />
                </div>
              </div>
            </div>

            {/* Fixed Footer */}
            <div className='mt-auto border-t px-6 pt-4 pb-6'>
              <div className='flex justify-between'>
                <Button variant='outline' onClick={handleCancel} type='button' disabled={isSaving}>
                  Cancel
                </Button>
                <Button
                  type='button'
                  onClick={handleSaveContent}
                  disabled={isSaving || editedContent === chunk.content}
                  className='bg-[#701FFC] font-[480] text-primary-foreground shadow-[0_0_0_0_#701FFC] transition-all duration-200 hover:bg-[#6518E6] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]'
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
