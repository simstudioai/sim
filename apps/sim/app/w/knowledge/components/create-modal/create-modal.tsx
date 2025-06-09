'use client'

import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { KnowledgeBaseData } from '@/stores/knowledge/store'
import { CreateForm } from './components/create-form/create-form'

interface CreateModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onKnowledgeBaseCreated?: (knowledgeBase: KnowledgeBaseData) => void
}

export function CreateModal({ open, onOpenChange, onKnowledgeBaseCreated }: CreateModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='flex h-[74vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]'
        hideCloseButton
      >
        <DialogHeader className='flex-shrink-0 border-b px-6 py-4'>
          <div className='flex items-center justify-between'>
            <DialogTitle className='font-medium text-lg'>Create Knowledge Base</DialogTitle>
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
          <CreateForm
            onClose={() => onOpenChange(false)}
            onKnowledgeBaseCreated={onKnowledgeBaseCreated}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
