'use client'

import { Database, Pause } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useCopilotTrainingStore } from '@/stores/copilot-training/store'

interface TrainingFloatingButtonProps {
  isTraining: boolean
  onToggleModal: () => void
}

/**
 * Floating button positioned above the diff controls
 * Shows training state and allows starting/stopping training
 */
export function TrainingFloatingButton({ isTraining, onToggleModal }: TrainingFloatingButtonProps) {
  const { stopTraining } = useCopilotTrainingStore()

  const handleClick = () => {
    if (isTraining) {
      // Stop and save the training session
      const dataset = stopTraining()
      if (dataset) {
        // Show a brief success indicator
        const button = document.getElementById('training-button')
        if (button) {
          button.classList.add('animate-pulse')
          setTimeout(() => button.classList.remove('animate-pulse'), 1000)
        }
      }
    } else {
      // Open modal to start new training
      onToggleModal()
    }
  }

  return (
    <div className='-translate-x-1/2 fixed bottom-32 left-1/2 z-30'>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            id='training-button'
            variant='outline'
            size='sm'
            onClick={handleClick}
            className={cn(
              'flex items-center gap-2 rounded-[14px] border bg-card/95 px-3 py-2 shadow-lg backdrop-blur-sm transition-all',
              'hover:bg-muted/80',
              isTraining &&
                'border-orange-500 bg-orange-50 dark:border-orange-400 dark:bg-orange-950/30'
            )}
          >
            {isTraining ? (
              <>
                <Pause className='h-4 w-4 text-orange-600 dark:text-orange-400' />
                <span className='font-medium text-orange-700 text-sm dark:text-orange-300'>
                  Stop Training
                </span>
              </>
            ) : (
              <>
                <Database className='h-4 w-4' />
                <span className='font-medium text-sm'>Train Copilot</span>
              </>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {isTraining
            ? 'Stop recording and save training dataset'
            : 'Start recording workflow changes for training'}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
