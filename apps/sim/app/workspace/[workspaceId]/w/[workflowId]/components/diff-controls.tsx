import { Eye, EyeOff } from 'lucide-react'
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
      // Create a checkpoint before applying changes so it appears under the triggering user message
      await createCheckpoint().catch((error) => {
        logger.warn('Failed to create checkpoint before accept:', error)
      })

      // Clear preview YAML immediately
      await clearPreviewYaml().catch((error) => {
        logger.warn('Failed to clear preview YAML:', error)
      })

      // Resolve target toolCallId for build/edit and update to terminal success state in the copilot store
      try {
        const { toolCallsById, messages } = useCopilotStore.getState()
        let id: string | undefined
        outer: for (let mi = messages.length - 1; mi >= 0; mi--) {
          const m = messages[mi]
          if (m.role !== 'assistant' || !m.contentBlocks) continue
          const blocks = m.contentBlocks as any[]
          for (let bi = blocks.length - 1; bi >= 0; bi--) {
            const b = blocks[bi]
            if (b?.type === 'tool_call') {
              const tn = b.toolCall?.name
              if (tn === 'build_workflow' || tn === 'edit_workflow') {
                id = b.toolCall?.id
                break outer
              }
            }
          }
        }
        if (!id) {
          const candidates = Object.values(toolCallsById).filter(
            (t) => t.name === 'build_workflow' || t.name === 'edit_workflow'
          )
          id = candidates.length ? candidates[candidates.length - 1].id : undefined
        }
        if (id) updatePreviewToolCallState('accepted', id)
      } catch {}

      // Accept changes without blocking the UI; errors will be logged by the store handler
      acceptChanges().catch((error) => {
        logger.error('Failed to accept changes (background):', error)
      })

      logger.info('Accept triggered; UI will update optimistically')
    } catch (error) {
      logger.error('Failed to accept changes:', error)

      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      console.error('Workflow update failed:', errorMessage)
      alert(`Failed to save workflow changes: ${errorMessage}`)
    }
  }

  const handleReject = () => {
    logger.info('Rejecting proposed changes (optimistic)')

    // Clear preview YAML immediately
    clearPreviewYaml().catch((error) => {
      logger.warn('Failed to clear preview YAML:', error)
    })

    // Resolve target toolCallId for build/edit and update to terminal rejected state in the copilot store
    try {
      const { toolCallsById, messages } = useCopilotStore.getState()
      let id: string | undefined
      outer: for (let mi = messages.length - 1; mi >= 0; mi--) {
        const m = messages[mi]
        if (m.role !== 'assistant' || !m.contentBlocks) continue
        const blocks = m.contentBlocks as any[]
        for (let bi = blocks.length - 1; bi >= 0; bi--) {
          const b = blocks[bi]
          if (b?.type === 'tool_call') {
            const tn = b.toolCall?.name
            if (tn === 'build_workflow' || tn === 'edit_workflow') {
              id = b.toolCall?.id
              break outer
            }
          }
        }
      }
      if (!id) {
        const candidates = Object.values(toolCallsById).filter(
          (t) => t.name === 'build_workflow' || t.name === 'edit_workflow'
        )
        id = candidates.length ? candidates[candidates.length - 1].id : undefined
      }
      if (id) updatePreviewToolCallState('rejected', id)
    } catch {}

    // Reject changes optimistically
    rejectChanges().catch((error) => {
      logger.error('Failed to reject changes (background):', error)
    })
  }

  return (
    <div className='-translate-x-1/2 fixed bottom-20 left-1/2 z-30'>
      <div className='flex items-center gap-2'>
        {/* Toggle (left, icon-only, no background) */}
        <Button
          variant='ghost'
          size='sm'
          onClick={handleToggleDiff}
          className='h-8 rounded-full px-2 text-muted-foreground hover:bg-transparent'
          title={isShowingDiff ? 'View original' : 'Preview changes'}
        >
          {isShowingDiff ? <Eye className='h-5 w-5' /> : <EyeOff className='h-5 w-5' />}
        </Button>

        {/* Reject (middle, light gray, icon-only) */}
        <Button
          variant='outline'
          size='sm'
          onClick={handleReject}
          className='h-8 rounded-[6px] border-gray-200 bg-gray-100 px-3 text-gray-700 hover:bg-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
          title='Reject changes'
        >
          Reject
        </Button>

        {/* Accept (right, brand purple, icon-only) */}
        <Button
          variant='default'
          size='sm'
          onClick={handleAccept}
          className='h-8 rounded-[6px] bg-[var(--brand-primary-hover-hex)] px-3 text-white hover:bg-[var(--brand-primary-hover-hex)]/90 hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]'
          title='Accept changes'
        >
          Accept
        </Button>
      </div>
    </div>
  )
}
