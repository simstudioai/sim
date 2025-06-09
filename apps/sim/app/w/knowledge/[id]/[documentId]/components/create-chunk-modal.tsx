'use client'

import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ChunkData, DocumentData } from '@/stores/knowledge/store'
import { CreateChunkForm } from './create-chunk-form'

interface CreateChunkModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: DocumentData | null
  knowledgeBaseId: string
  onChunkCreated?: (chunk: ChunkData) => void
}

export function CreateChunkModal({
  open,
  onOpenChange,
  document,
  knowledgeBaseId,
  onChunkCreated,
}: CreateChunkModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='flex h-[74vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]'
        hideCloseButton
      >
        <DialogHeader className='flex-shrink-0 border-b px-6 py-4'>
          <div className='flex items-center justify-between'>
            <DialogTitle className='font-medium text-lg'>Create Chunk</DialogTitle>
            <Button
              variant='ghost'
              size='icon'
              className='h-8 w-8 p-0'
              onClick={() => onOpenChange(false)}
            >
              <X className='h-4 w-4' />
              <span className='sr-only'>Close</span>
            </Button>
          </div>
        </DialogHeader>

        <div className='flex flex-1 flex-col overflow-hidden'>
          <CreateChunkForm
            document={document}
            knowledgeBaseId={knowledgeBaseId}
            onClose={() => onOpenChange(false)}
            onChunkCreated={onChunkCreated}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
