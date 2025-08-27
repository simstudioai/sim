'use client'

import { useEffect } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { AlertCircle, History, RotateCcw } from 'lucide-react'
import { Button, ScrollArea, Separator } from '@/components/ui'
import { useCopilotStore } from '@/stores/copilot/store'

export function CheckpointPanel() {
  const {
    currentChat,
    checkpoints,
    isLoadingCheckpoints,
    isRevertingCheckpoint,
    checkpointError,
    loadCheckpoints,
    revertToCheckpoint: revertToCheckpointAction,
    clearCheckpointError,
  } = useCopilotStore()

  // Load checkpoints when chat changes
  useEffect(() => {
    if (currentChat?.id) {
      loadCheckpoints(currentChat.id)
    }
  }, [currentChat?.id, loadCheckpoints])

  if (!currentChat) {
    return (
      <div className='p-4 text-center text-muted-foreground'>
        <History className='mx-auto mb-2 h-8 w-8' />
        <p>No chat selected</p>
      </div>
    )
  }

  if (isLoadingCheckpoints) {
    return (
      <div className='p-4 text-center text-muted-foreground'>
        <div className='mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600' />
        <p>Loading checkpoints...</p>
      </div>
    )
  }

  if (checkpointError) {
    return (
      <div className='p-4'>
        <div className='mb-3 flex items-center gap-2 text-red-600'>
          <AlertCircle className='h-4 w-4' />
          <span className='font-medium text-sm'>Error loading checkpoints</span>
        </div>
        <p className='mb-3 text-muted-foreground text-xs'>{checkpointError}</p>
        <Button
          size='sm'
          variant='outline'
          onClick={() => {
            clearCheckpointError()
            loadCheckpoints(currentChat.id)
          }}
        >
          Retry
        </Button>
      </div>
    )
  }

  if (checkpoints.length === 0) {
    return (
      <div className='p-4 text-center text-muted-foreground'>
        <History className='mx-auto mb-2 h-8 w-8' />
        <p className='text-sm'>No checkpoints yet</p>
        <p className='mt-1 text-xs'>
          Checkpoints are created automatically when the agent edits your workflow
        </p>
      </div>
    )
  }

  const handleRevert = async (checkpointId: string) => {
    if (
      window.confirm(
        'Are you sure you want to revert to this checkpoint? This will replace your current workflow.'
      )
    ) {
      await revertToCheckpointAction(checkpointId)
    }
  }

  return (
    <div className='flex h-full flex-col'>
      <div className='border-b p-4'>
        <div className='flex items-center gap-2'>
          <History className='h-4 w-4' />
          <h3 className='font-medium text-sm'>Workflow Checkpoints</h3>
        </div>
        <p className='mt-1 text-muted-foreground text-xs'>
          Restore your workflow to a previous state
        </p>
      </div>

      <ScrollArea className='flex-1'>
        <div className='p-2'>
          {checkpoints.map((checkpoint, index) => (
            <div key={checkpoint.id} className='mb-2'>
              <div className='rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50'>
                <div className='flex items-start justify-between gap-2'>
                  <div className='min-w-0 flex-1'>
                    <div className='mb-1 flex items-center gap-2'>
                      <div className='h-2 w-2 rounded-full bg-purple-500' />
                      <span className='font-medium text-muted-foreground text-xs'>
                        Checkpoint {checkpoints.length - index}
                      </span>
                    </div>
                    <p className='text-muted-foreground text-xs'>
                      {formatDistanceToNow(new Date(checkpoint.createdAt), { addSuffix: true })}
                    </p>
                    <p className='mt-1 text-muted-foreground text-xs'>
                      {new Date(checkpoint.createdAt).toLocaleDateString()} at{' '}
                      {new Date(checkpoint.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <Button
                    size='sm'
                    variant='ghost'
                    className='h-6 px-2 text-xs'
                    onClick={() => handleRevert(checkpoint.id)}
                    disabled={isRevertingCheckpoint}
                  >
                    <RotateCcw className='mr-1 h-3 w-3' />
                    Revert
                  </Button>
                </div>
              </div>
              {index < checkpoints.length - 1 && <Separator className='mt-2' />}
            </div>
          ))}
        </div>
      </ScrollArea>

      {isRevertingCheckpoint && (
        <div className='border-t bg-muted/30 p-3'>
          <div className='flex items-center gap-2 text-muted-foreground text-sm'>
            <div className='h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600' />
            Reverting workflow...
          </div>
        </div>
      )}
    </div>
  )
}
