import { Check, Eye, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console-logger'
import { useCopilotStore } from '@/stores/copilot/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff'

const logger = createLogger('DiffControls')

export function DiffControls() {
  const {
    isShowingDiff,
    isDiffReady,
    diffWorkflow,
    toggleDiffView,
    acceptChanges,
    rejectChanges,
    diffMetadata,
  } = useWorkflowDiffStore()

  const { updatePreviewToolCallState, clearPreviewYaml } = useCopilotStore()

  // Don't show anything if no diff is available or diff is not ready
  if (!diffWorkflow || !isDiffReady) {
    return null
  }

  const handleToggleDiff = () => {
    logger.info('Toggling diff view', { currentState: isShowingDiff })
    toggleDiffView()
  }

  const handleAccept = () => {
    logger.info('Accepting proposed changes (optimistic)')

    // Immediately update UI state (optimistic)
    updatePreviewToolCallState('applied')
    clearPreviewYaml().catch((error) => {
      logger.warn('Failed to clear preview YAML:', error)
    })

    // Start background save without awaiting
    acceptChanges().catch((error) => {
      logger.error('Failed to accept changes in background:', error)
      // TODO: Consider showing a toast notification for save failures
      // For now, the optimistic update stands since the UI state is already correct
    })

    logger.info('Optimistically applied changes, saving in background')
  }

  const handleReject = () => {
    logger.info('Rejecting proposed changes (optimistic)')

    // Immediately update UI state (optimistic)
    updatePreviewToolCallState('rejected')
    clearPreviewYaml().catch((error) => {
      logger.warn('Failed to clear preview YAML:', error)
    })

    // Reject is immediate (no server save needed)
    rejectChanges()

    logger.info('Successfully rejected proposed changes')
  }

  return (
    <div className='-translate-x-1/2 fixed bottom-20 left-1/2 z-30'>
      <div className='rounded-lg border bg-background/95 p-4 shadow-lg backdrop-blur-sm'>
        <div className='flex items-center gap-4'>
          {/* Info section */}
          <div className='flex items-center gap-2'>
            <div className='flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900'>
              <Eye className='h-4 w-4 text-purple-600 dark:text-purple-400' />
            </div>
            <div className='flex flex-col'>
              <span className='font-medium text-sm'>
                {isShowingDiff ? 'Viewing Proposed Changes' : 'Copilot has proposed changes'}
              </span>
              {diffMetadata && (
                <span className='text-muted-foreground text-xs'>
                  Source: {diffMetadata.source} •{' '}
                  {new Date(diffMetadata.timestamp).toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className='flex items-center gap-2'>
            {/* Toggle View Button */}
            <Button
              variant={isShowingDiff ? 'default' : 'outline'}
              size='sm'
              onClick={handleToggleDiff}
              className='h-8'
            >
              {isShowingDiff ? 'View Original' : 'Preview Changes'}
            </Button>

            {/* Accept/Reject buttons - only show when viewing diff */}
            {isShowingDiff && (
              <>
                <Button
                  variant='default'
                  size='sm'
                  onClick={handleAccept}
                  className='h-8 bg-green-600 px-3 hover:bg-green-700'
                >
                  <Check className='mr-1 h-3 w-3' />
                  Accept
                </Button>
                <Button variant='destructive' size='sm' onClick={handleReject} className='h-8 px-3'>
                  <X className='mr-1 h-3 w-3' />
                  Reject
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
