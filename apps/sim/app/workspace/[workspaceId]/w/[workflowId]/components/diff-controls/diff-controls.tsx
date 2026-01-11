import { memo, useCallback, useMemo } from 'react'
import { createLogger } from '@sim/logger'
import clsx from 'clsx'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { createCommand } from '@/app/workspace/[workspaceId]/utils/commands-utils'
import { usePreventZoom } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { useCopilotStore, usePanelStore } from '@/stores/panel'
import { useTerminalStore } from '@/stores/terminal'
import { useWorkflowDiffStore } from '@/stores/workflow-diff'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('DiffControls')

export const DiffControls = memo(function DiffControls() {
  const isTerminalResizing = useTerminalStore((state) => state.isResizing)
  const isPanelResizing = usePanelStore((state) => state.isResizing)
  const { isDiffReady, hasActiveDiff, acceptChanges, rejectChanges, baselineWorkflow } =
    useWorkflowDiffStore(
      useCallback(
        (state) => ({
          isDiffReady: state.isDiffReady,
          hasActiveDiff: state.hasActiveDiff,
          acceptChanges: state.acceptChanges,
          rejectChanges: state.rejectChanges,
          baselineWorkflow: state.baselineWorkflow,
        }),
        []
      )
    )

  const { updatePreviewToolCallState, currentChat, messages } = useCopilotStore(
    useCallback(
      (state) => ({
        updatePreviewToolCallState: state.updatePreviewToolCallState,
        currentChat: state.currentChat,
        messages: state.messages,
      }),
      []
    )
  )

  const { activeWorkflowId } = useWorkflowRegistry(
    useCallback((state) => ({ activeWorkflowId: state.activeWorkflowId }), [])
  )

  const createCheckpoint = useCallback(async () => {
    if (!activeWorkflowId || !currentChat?.id) {
      logger.warn('Cannot create checkpoint: missing workflowId or chatId', {
        workflowId: activeWorkflowId,
        chatId: currentChat?.id,
      })
      return false
    }

    try {
      logger.info('Creating checkpoint before accepting changes')

      // Use the baseline workflow (state before diff) instead of current state
      // This ensures reverting to the checkpoint restores the pre-diff state
      const rawState = baselineWorkflow || useWorkflowStore.getState().getWorkflowState()

      // The baseline already has merged subblock values, but we'll merge again to be safe
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
        deploymentStatuses: rawState.deploymentStatuses || {},
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
  }, [activeWorkflowId, currentChat, messages, baselineWorkflow])

  const handleAccept = useCallback(() => {
    logger.info('Accepting proposed changes with backup protection')

    // Resolve target toolCallId for build/edit and update to terminal success state in the copilot store
    // This happens synchronously first for instant UI feedback
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
            if (tn === 'edit_workflow') {
              id = b.toolCall?.id
              break outer
            }
          }
        }
      }
      if (!id) {
        const candidates = Object.values(toolCallsById).filter((t) => t.name === 'edit_workflow')
        id = candidates.length ? candidates[candidates.length - 1].id : undefined
      }
      if (id) updatePreviewToolCallState('accepted', id)
    } catch {}

    // Accept changes without blocking the UI; errors will be logged by the store handler
    acceptChanges().catch((error) => {
      logger.error('Failed to accept changes (background):', error)
    })

    // Create checkpoint in the background (fire-and-forget) so it doesn't block UI
    createCheckpoint().catch((error) => {
      logger.warn('Failed to create checkpoint after accept:', error)
    })

    logger.info('Accept triggered; UI will update optimistically')
  }, [createCheckpoint, updatePreviewToolCallState, acceptChanges])

  const handleReject = useCallback(() => {
    logger.info('Rejecting proposed changes (optimistic)')

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
            if (tn === 'edit_workflow') {
              id = b.toolCall?.id
              break outer
            }
          }
        }
      }
      if (!id) {
        const candidates = Object.values(toolCallsById).filter((t) => t.name === 'edit_workflow')
        id = candidates.length ? candidates[candidates.length - 1].id : undefined
      }
      if (id) updatePreviewToolCallState('rejected', id)
    } catch {}

    // Reject changes optimistically
    rejectChanges().catch((error) => {
      logger.error('Failed to reject changes (background):', error)
    })
  }, [updatePreviewToolCallState, rejectChanges])

  const preventZoomRef = usePreventZoom()

  // Register global command to accept changes (Cmd/Ctrl + Shift + Enter)
  const acceptCommand = useMemo(
    () =>
      createCommand({
        id: 'accept-diff-changes',
        handler: () => {
          if (hasActiveDiff && isDiffReady) {
            handleAccept()
          }
        },
      }),
    [hasActiveDiff, isDiffReady, handleAccept]
  )
  useRegisterGlobalCommands([acceptCommand])

  // Don't show anything if no diff is available or diff is not ready
  if (!hasActiveDiff || !isDiffReady) {
    return null
  }

  const isResizing = isTerminalResizing || isPanelResizing

  return (
    <div
      ref={preventZoomRef}
      className={clsx(
        'fixed z-30',
        !isResizing && 'transition-[bottom,right] duration-100 ease-out'
      )}
      style={{
        bottom: 'calc(var(--terminal-height) + 16px)',
        right: 'calc(var(--panel-width) + 16px)',
      }}
    >
      <div
        className='group relative flex h-[30px] overflow-hidden rounded-[4px]'
        style={{ isolation: 'isolate' }}
      >
        {/* Reject side */}
        <button
          onClick={handleReject}
          title='Reject changes'
          className='relative flex h-full items-center border border-[var(--border)] bg-[var(--surface-4)] pr-[20px] pl-[12px] font-medium text-[13px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-1)] hover:bg-[var(--surface-6)] hover:text-[var(--text-primary)] dark:hover:bg-[var(--surface-5)]'
          style={{
            clipPath: 'polygon(0 0, calc(100% + 10px) 0, 100% 100%, 0 100%)',
            borderRadius: '4px 0 0 4px',
          }}
        >
          Reject
        </button>
        {/* Slanted divider - split gray/green */}
        <div
          className='pointer-events-none absolute top-0 bottom-0 z-10'
          style={{
            left: '66px',
            width: '2px',
            transform: 'skewX(-18.4deg)',
            background:
              'linear-gradient(to right, var(--border) 50%, color-mix(in srgb, var(--brand-tertiary-2) 70%, black) 50%)',
          }}
        />
        {/* Accept side */}
        <button
          onClick={handleAccept}
          title='Accept changes (⇧⌘⏎)'
          className='-ml-[10px] relative flex h-full items-center border border-[rgba(0,0,0,0.15)] bg-[var(--brand-tertiary-2)] pr-[12px] pl-[20px] font-medium text-[13px] text-[var(--text-inverse)] transition-[background-color,border-color,fill,stroke] hover:brightness-110 dark:border-[rgba(255,255,255,0.1)]'
          style={{
            clipPath: 'polygon(10px 0, 100% 0, 100% 100%, 0 100%)',
            borderRadius: '0 4px 4px 0',
          }}
        >
          Accept
          <kbd className='ml-2 rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-medium font-sans text-[10px]'>
            ⇧⌘<span className='translate-y-[-1px]'>⏎</span>
          </kbd>
        </button>
      </div>
    </div>
  )
})
