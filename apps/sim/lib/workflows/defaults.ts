import { getBlockOutputs } from '@/lib/workflows/block-outputs'
import { getBlock } from '@/blocks'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import type { BlockState, SubBlockState, WorkflowState } from '@/stores/workflows/workflow/types'

export interface DefaultWorkflowArtifacts {
  workflowState: WorkflowState
  subBlockValues: Record<string, Record<string, unknown>>
  startBlockId: string
}

const START_BLOCK_TYPE = 'start_trigger'
const DEFAULT_START_POSITION = { x: 0, y: 0 }

function cloneDefaultValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneDefaultValue(item))
  }

  if (value && typeof value === 'object') {
    return { ...(value as Record<string, unknown>) }
  }

  return value ?? null
}

function resolveInitialValue(subBlock: SubBlockConfig): unknown {
  if (typeof subBlock.value === 'function') {
    try {
      return cloneDefaultValue(subBlock.value({}))
    } catch (error) {
      // Ignore resolution errors and fall back to default/null values
    }
  }

  if (subBlock.defaultValue !== undefined) {
    return cloneDefaultValue(subBlock.defaultValue)
  }

  if (subBlock.type === 'input-format') {
    return [
      {
        id: crypto.randomUUID(),
        name: '',
        type: 'string',
        value: '',
        collapsed: false,
      },
    ]
  }

  if (subBlock.type === 'table') {
    return []
  }

  return null
}

function buildStartBlockConfig(): BlockConfig {
  const blockConfig = getBlock(START_BLOCK_TYPE)

  if (!blockConfig) {
    throw new Error('Start trigger block configuration is not registered')
  }

  return blockConfig
}

function buildStartBlockState(
  blockConfig: BlockConfig,
  blockId: string
): { blockState: BlockState; subBlockValues: Record<string, unknown> } {
  const subBlocks: Record<string, SubBlockState> = {}
  const subBlockValues: Record<string, unknown> = {}

  blockConfig.subBlocks.forEach((config) => {
    const initialValue = resolveInitialValue(config)

    subBlocks[config.id] = {
      id: config.id,
      type: config.type,
      value: (initialValue ?? null) as SubBlockState['value'],
    }

    subBlockValues[config.id] = initialValue ?? null
  })

  const outputs = getBlockOutputs(blockConfig.type, subBlocks)

  const blockState: BlockState = {
    id: blockId,
    type: blockConfig.type,
    name: blockConfig.name,
    position: { ...DEFAULT_START_POSITION },
    subBlocks,
    outputs,
    enabled: true,
    horizontalHandles: true,
    advancedMode: false,
    triggerMode: false,
    height: 0,
    data: {},
  }

  return { blockState, subBlockValues }
}

export function buildDefaultWorkflowArtifacts(): DefaultWorkflowArtifacts {
  const blockConfig = buildStartBlockConfig()
  const startBlockId = crypto.randomUUID()

  const { blockState, subBlockValues } = buildStartBlockState(blockConfig, startBlockId)

  const workflowState: WorkflowState = {
    blocks: {
      [startBlockId]: blockState,
    },
    edges: [],
    loops: {},
    parallels: {},
    lastSaved: Date.now(),
    isDeployed: false,
    deployedAt: undefined,
    deploymentStatuses: {},
    needsRedeployment: false,
  }

  return {
    workflowState,
    subBlockValues: {
      [startBlockId]: subBlockValues,
    },
    startBlockId,
  }
}
