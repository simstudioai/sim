'use client'

import { AlertTriangle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface OperationStatusProps {
  error: string | null
  onDismiss: () => void
}

export function OperationStatus({ error, onDismiss }: OperationStatusProps) {
  // Don't render anything if no error
  if (!error) {
    return null
  }

  return (
    <div className='flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2'>
      <div className='flex items-center gap-2 text-red-700'>
        <div className='relative flex items-center justify-center'>
          <div className='absolute h-4 w-4 animate-ping rounded-full bg-red-500/20' />
          <AlertTriangle className='relative h-4 w-4' />
        </div>
        <div className='flex flex-col'>
          <span className='font-medium text-xs leading-tight'>Workflow Edit Failed</span>
          <span className='text-red-600 text-xs leading-tight'>{error}</span>
        </div>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={onDismiss}
            variant='ghost'
            size='sm'
            className='h-7 w-7 p-0 text-red-700 hover:bg-red-100 hover:text-red-800'
          >
            <X className='h-4 w-4' />
          </Button>
        </TooltipTrigger>
        <TooltipContent className='z-[9999]'>Dismiss error</TooltipContent>
      </Tooltip>
    </div>
  )
}
