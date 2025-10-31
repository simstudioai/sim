import type { ExecutionContext } from '@/executor/types'

export interface BlockDataCollection {
  blockData: Record<string, any>
  blockNameMapping: Record<string, string>
}

export function collectBlockData(context: ExecutionContext): BlockDataCollection {
  const blockData: Record<string, any> = {}
  const blockNameMapping: Record<string, string> = {}

  for (const [id, state] of context.blockStates.entries()) {
    if (state.output !== undefined) {
      blockData[id] = state.output
      const workflowBlock = context.workflow?.blocks?.find((b) => b.id === id)
      if (workflowBlock?.metadata?.name) {
        blockNameMapping[workflowBlock.metadata.name] = id
        const normalized = workflowBlock.metadata.name.replace(/\s+/g, '').toLowerCase()
        blockNameMapping[normalized] = id
      }
    }
  }

  return { blockData, blockNameMapping }
}

