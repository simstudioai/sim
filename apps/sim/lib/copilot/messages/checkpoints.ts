import { createLogger } from '@sim/logger'
import { COPILOT_CHECKPOINTS_API_PATH } from '@/lib/copilot/constants'
import type { CopilotMessage, CopilotStore, CopilotToolCall } from '@/stores/panel/copilot/types'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('CopilotMessageCheckpoints')

export function buildCheckpointWorkflowState(workflowId: string): WorkflowState | null {
  const rawState = useWorkflowStore.getState().getWorkflowState()
  if (!rawState) return null

  const blocksWithSubblockValues = mergeSubblockState(rawState.blocks, workflowId)

  const filteredBlocks = Object.entries(blocksWithSubblockValues).reduce(
    (acc, [blockId, block]) => {
      if (block?.type && block?.name) {
        acc[blockId] = {
          ...block,
          id: block.id || blockId,
          enabled: block.enabled !== undefined ? block.enabled : true,
          horizontalHandles: block.horizontalHandles !== undefined ? block.horizontalHandles : true,
          height: block.height !== undefined ? block.height : 90,
          subBlocks: block.subBlocks ?? {},
          outputs: block.outputs ?? {},
          data: block.data ?? {},
          position: block.position || { x: 0, y: 0 },
        }
      }
      return acc
    },
    {} as WorkflowState['blocks']
  )

  return {
    blocks: filteredBlocks,
    edges: rawState.edges ?? [],
    loops: rawState.loops ?? {},
    parallels: rawState.parallels ?? {},
    lastSaved: rawState.lastSaved || Date.now(),
    deploymentStatuses: rawState.deploymentStatuses ?? {},
  }
}

export async function saveMessageCheckpoint(
  messageId: string,
  get: () => CopilotStore,
  set: (partial: Partial<CopilotStore> | ((state: CopilotStore) => Partial<CopilotStore>)) => void
): Promise<boolean> {
  const { workflowId, currentChat, messageSnapshots, messageCheckpoints } = get()
  if (!workflowId || !currentChat?.id) return false

  const snapshot = messageSnapshots[messageId]
  if (!snapshot) return false

  const nextSnapshots = { ...messageSnapshots }
  delete nextSnapshots[messageId]
  set({ messageSnapshots: nextSnapshots })

  try {
    const response = await fetch(COPILOT_CHECKPOINTS_API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowId,
        chatId: currentChat.id,
        messageId,
        workflowState: JSON.stringify(snapshot),
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to create checkpoint: ${response.statusText}`)
    }

    const result = await response.json()
    const newCheckpoint = result.checkpoint
    if (newCheckpoint) {
      const existingCheckpoints = messageCheckpoints[messageId] ?? []
      const updatedCheckpoints = {
        ...messageCheckpoints,
        [messageId]: [newCheckpoint, ...existingCheckpoints],
      }
      set({ messageCheckpoints: updatedCheckpoints })
    }

    return true
  } catch (error) {
    logger.error('Failed to create checkpoint from snapshot:', error)
    return false
  }
}

export function extractToolCallsRecursively(
  toolCall: CopilotToolCall,
  map: Record<string, CopilotToolCall>
): void {
  if (!toolCall?.id) return
  map[toolCall.id] = toolCall

  if (Array.isArray(toolCall.subAgentBlocks)) {
    for (const block of toolCall.subAgentBlocks) {
      if (block?.type === 'subagent_tool_call' && block.toolCall?.id) {
        extractToolCallsRecursively(block.toolCall, map)
      }
    }
  }

  if (Array.isArray(toolCall.subAgentToolCalls)) {
    for (const subTc of toolCall.subAgentToolCalls) {
      extractToolCallsRecursively(subTc, map)
    }
  }
}

export function buildToolCallsById(messages: CopilotMessage[]): Record<string, CopilotToolCall> {
  const toolCallsById: Record<string, CopilotToolCall> = {}
  for (const msg of messages) {
    if (msg.contentBlocks) {
      for (const block of msg.contentBlocks) {
        if (block?.type === 'tool_call' && block.toolCall?.id) {
          extractToolCallsRecursively(block.toolCall, toolCallsById)
        }
      }
    }
  }
  return toolCallsById
}
