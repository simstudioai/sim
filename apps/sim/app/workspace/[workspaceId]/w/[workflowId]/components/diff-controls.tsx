import { Check, Eye, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console/logger'
import { useCopilotStore } from '@/stores/copilot/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

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

  const { updatePreviewToolCallState, clearPreviewYaml, currentChat, messages } = useCopilotStore()
  const { activeWorkflowId } = useWorkflowRegistry()

  // Don't show anything if no diff is available or diff is not ready
  if (!diffWorkflow || !isDiffReady) {
    return null
  }

  const handleToggleDiff = () => {
    logger.info('Toggling diff view', { currentState: isShowingDiff })
    toggleDiffView()
  }

  const createCheckpoint = async () => {
    if (!activeWorkflowId || !currentChat?.id) {
      logger.warn('Cannot create checkpoint: missing workflowId or chatId', {
        workflowId: activeWorkflowId,
        chatId: currentChat?.id,
      })
      return false
    }

    try {
      logger.info('Creating checkpoint before accepting changes')

      // Get current workflow state from the store and ensure it's complete
      const rawState = useWorkflowStore.getState().getWorkflowState()

      // Merge subblock values from the SubBlockStore to get complete state
      // This ensures all user inputs and subblock data are captured
      const blocksWithSubblockValues = mergeSubblockState(rawState.blocks, activeWorkflowId)

      // Filter and complete blocks to ensure all required fields are present
      // This matches the validation logic from /api/workflows/[id]/state
      const filteredBlocks = Object.entries(blocksWithSubblockValues).reduce(
        (acc, [blockId, block]) => {
          if (block.type && block.name) {
            // Ensure all required fields are present
            acc[blockId] = {
              ...block,
              id: block.id || blockId, // Ensure id field is set
              enabled: block.enabled !== undefined ? block.enabled : true,
              horizontalHandles:
                block.horizontalHandles !== undefined ? block.horizontalHandles : true,
              isWide: block.isWide !== undefined ? block.isWide : false,
              height: block.height !== undefined ? block.height : 90,
              subBlocks: block.subBlocks || {},
              outputs: block.outputs || {},
              data: block.data || {},
              position: block.position || { x: 0, y: 0 }, // Ensure position exists
            }
          }
          return acc
        },
        {} as typeof rawState.blocks
      )

      // Clean the workflow state - only include valid fields, exclude null/undefined values
      const workflowState = {
        blocks: filteredBlocks,
        edges: rawState.edges || [],
        loops: rawState.loops || {},
        parallels: rawState.parallels || {},
        lastSaved: rawState.lastSaved || Date.now(),
        isDeployed: rawState.isDeployed || false,
        deploymentStatuses: rawState.deploymentStatuses || {},
        hasActiveWebhook: rawState.hasActiveWebhook || false,
        // Only include deployedAt if it's a valid date, never include null/undefined
        ...(rawState.deployedAt && rawState.deployedAt instanceof Date
          ? { deployedAt: rawState.deployedAt }
          : {}),
      }

      logger.info('Prepared complete workflow state for checkpoint', {
        blocksCount: Object.keys(workflowState.blocks).length,
        edgesCount: workflowState.edges.length,
        loopsCount: Object.keys(workflowState.loops).length,
        parallelsCount: Object.keys(workflowState.parallels).length,
        hasRequiredFields: Object.values(workflowState.blocks).every(
          (block) => block.id && block.type && block.name && block.position
        ),
        hasSubblockValues: Object.values(workflowState.blocks).some((block) =>
          Object.values(block.subBlocks || {}).some(
            (subblock) => subblock.value !== null && subblock.value !== undefined
          )
        ),
        sampleBlock: Object.values(workflowState.blocks)[0],
      })

      // Find the most recent user message ID from the current chat
      const userMessages = messages.filter((msg) => msg.role === 'user')
      const lastUserMessage = userMessages[userMessages.length - 1]
      const messageId = lastUserMessage?.id

      logger.info('Creating checkpoint with message association', {
        totalMessages: messages.length,
        userMessageCount: userMessages.length,
        lastUserMessageId: messageId,
        chatId: currentChat.id,
        entireMessageArray: messages,
        allMessageIds: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content.substring(0, 50),
        })),
        selectedUserMessages: userMessages.map((m) => ({
          id: m.id,
          content: m.content.substring(0, 100),
        })),
        allRawMessageIds: messages.map((m) => m.id),
        userMessageIds: userMessages.map((m) => m.id),
        checkpointData: {
          workflowId: activeWorkflowId,
          chatId: currentChat.id,
          messageId: messageId,
          messageFound: !!lastUserMessage,
        },
      })

      const response = await fetch('/api/copilot/checkpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: activeWorkflowId,
          chatId: currentChat.id,
          messageId,
          workflowState: JSON.stringify(workflowState),
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to create checkpoint: ${response.statusText}`)
      }

      const result = await response.json()
      const newCheckpoint = result.checkpoint

      logger.info('Checkpoint created successfully', {
        messageId,
        chatId: currentChat.id,
        checkpointId: newCheckpoint?.id,
      })

      // Update the copilot store immediately to show the checkpoint icon
      if (newCheckpoint && messageId) {
        const { messageCheckpoints: currentCheckpoints } = useCopilotStore.getState()
        const existingCheckpoints = currentCheckpoints[messageId] || []

        const updatedCheckpoints = {
          ...currentCheckpoints,
          [messageId]: [newCheckpoint, ...existingCheckpoints],
        }

        useCopilotStore.setState({ messageCheckpoints: updatedCheckpoints })
        logger.info('Updated copilot store with new checkpoint', {
          messageId,
          checkpointId: newCheckpoint.id,
        })
      }

      return true
    } catch (error) {
      logger.error('Failed to create checkpoint:', error)
      return false
    }
  }

  const handleAccept = async () => {
    logger.info('Accepting proposed changes with backup protection')

    try {
      // Clear preview YAML immediately
      await clearPreviewYaml().catch((error) => {
        logger.warn('Failed to clear preview YAML:', error)
      })

      // Accept changes with automatic backup and rollback on failure
      await acceptChanges()

      logger.info('Successfully accepted and saved workflow changes')
      // Show success feedback if needed
    } catch (error) {
      logger.error('Failed to accept changes:', error)

      // Show error notification to user
      // Note: The acceptChanges function has already rolled back the state
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'

      // You could add toast notification here
      console.error('Workflow update failed:', errorMessage)

      // Optionally show user-facing error dialog
      alert(`Failed to save workflow changes: ${errorMessage}`)
    }
  }

  const handleReject = () => {
    logger.info('Rejecting proposed changes (optimistic)')

    // Clear preview YAML immediately
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
