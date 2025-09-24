import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { SIM_AGENT_API_URL_DEFAULT } from '@/lib/sim-agent'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { validateWorkflowState } from '@/lib/workflows/validation'
import { getAllBlocks } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { resolveOutputType } from '@/blocks/utils'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'

interface EditWorkflowOperation {
  operation_type: 'add' | 'edit' | 'delete'
  block_id: string
  params?: Record<string, any>
}

interface EditWorkflowParams {
  operations: EditWorkflowOperation[]
  workflowId: string
  currentUserWorkflow?: string
}

const SIM_AGENT_API_URL = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT

async function applyOperationsToYaml(
  currentYaml: string,
  operations: EditWorkflowOperation[]
): Promise<string> {
  const blocks = getAllBlocks()
  const blockRegistry = blocks.reduce(
    (acc, block) => {
      const blockType = (block as any).type
      ;(acc as any)[blockType] = {
        ...(block as any),
        id: blockType,
        subBlocks: (block as any).subBlocks || [],
        outputs: (block as any).outputs || {},
      }
      return acc
    },
    {} as Record<string, BlockConfig>
  )

  const parseResponse = await fetch(`${SIM_AGENT_API_URL}/api/yaml/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      yamlContent: currentYaml,
      blockRegistry,
      utilities: {
        generateLoopBlocks: generateLoopBlocks.toString(),
        generateParallelBlocks: generateParallelBlocks.toString(),
        resolveOutputType: resolveOutputType.toString(),
      },
    }),
  })
  if (!parseResponse.ok) throw new Error(`Sim agent API error: ${parseResponse.statusText}`)
  const parseResult = await parseResponse.json()
  if (!parseResult.success || !parseResult.data || parseResult.errors?.length > 0) {
    throw new Error(`Invalid YAML format: ${parseResult.errors?.join(', ') || 'Unknown error'}`)
  }
  const workflowData = parseResult.data

  // Reorder operations: delete -> add -> edit to ensure consistent application semantics
  const deletes = operations.filter((op) => op.operation_type === 'delete')
  const adds = operations.filter((op) => op.operation_type === 'add')
  const edits = operations.filter((op) => op.operation_type === 'edit')
  const orderedOperations: EditWorkflowOperation[] = [...deletes, ...adds, ...edits]

  for (const operation of orderedOperations) {
    const { operation_type, block_id, params } = operation
    switch (operation_type) {
      case 'delete':
        if (workflowData.blocks[block_id]) {
          const childBlocksToRemove: string[] = []
          Object.entries(workflowData.blocks).forEach(([childId, child]: [string, any]) => {
            if (child.parentId === block_id) childBlocksToRemove.push(childId)
          })
          delete workflowData.blocks[block_id]
          childBlocksToRemove.forEach((childId) => delete workflowData.blocks[childId])
          const allDeleted = [block_id, ...childBlocksToRemove]
          Object.values(workflowData.blocks).forEach((block: any) => {
            if (!block.connections) return
            Object.keys(block.connections).forEach((key) => {
              const value = block.connections[key]
              if (typeof value === 'string') {
                if (allDeleted.includes(value)) delete block.connections[key]
              } else if (Array.isArray(value)) {
                block.connections[key] = value.filter((item: any) =>
                  typeof item === 'string'
                    ? !allDeleted.includes(item)
                    : !allDeleted.includes(item?.block)
                )
                if (block.connections[key].length === 0) delete block.connections[key]
              } else if (typeof value === 'object' && value?.block) {
                if (allDeleted.includes(value.block)) delete block.connections[key]
              }
            })
          })
        }
        break
      case 'edit':
        if (workflowData.blocks[block_id]) {
          const block = workflowData.blocks[block_id]
          if (params?.inputs) {
            if (!block.inputs) block.inputs = {}
            Object.assign(block.inputs, params.inputs)
          }
          if (params?.connections) {
            if (!block.connections) block.connections = {}
            Object.entries(params.connections).forEach(([key, value]) => {
              if (value === null) delete block.connections[key]
              else (block.connections as any)[key] = value
            })
          }
          if (params?.type) block.type = params.type
          if (params?.name) block.name = params.name
          // Handle trigger mode toggle and clean incoming edges when enabling
          if (typeof params?.triggerMode === 'boolean') {
            // Set triggerMode as a top-level block property
            block.triggerMode = params.triggerMode

            if (params.triggerMode === true) {
              // Remove all incoming connections where this block is referenced as a target
              Object.values(workflowData.blocks).forEach((other: any) => {
                if (!other?.connections) return
                Object.keys(other.connections).forEach((handle) => {
                  const value = other.connections[handle]
                  if (typeof value === 'string') {
                    if (value === block_id) delete other.connections[handle]
                  } else if (Array.isArray(value)) {
                    other.connections[handle] = value.filter((item: any) =>
                      typeof item === 'string' ? item !== block_id : item?.block !== block_id
                    )
                    if (other.connections[handle].length === 0) delete other.connections[handle]
                  } else if (typeof value === 'object' && value?.block) {
                    if (value.block === block_id) delete other.connections[handle]
                  }
                })
              })
            }
          }
          if (params?.removeEdges && Array.isArray(params.removeEdges)) {
            params.removeEdges.forEach(({ targetBlockId, sourceHandle = 'default' }) => {
              const value = block.connections?.[sourceHandle]
              if (typeof value === 'string') {
                if (value === targetBlockId) delete (block.connections as any)[sourceHandle]
              } else if (Array.isArray(value)) {
                ;(block.connections as any)[sourceHandle] = value.filter((item: any) =>
                  typeof item === 'string' ? item !== targetBlockId : item?.block !== targetBlockId
                )
                if ((block.connections as any)[sourceHandle].length === 0)
                  delete (block.connections as any)[sourceHandle]
              } else if (typeof value === 'object' && value?.block) {
                if (value.block === targetBlockId) delete (block.connections as any)[sourceHandle]
              }
            })
          }
        }
        break
      case 'add':
        if (params?.type && params?.name) {
          workflowData.blocks[block_id] = {
            type: params.type,
            name: params.name,
            inputs: params.inputs || {},
            connections: params.connections || {},
          }
        }
        break
    }
  }

  const { dump: yamlDump } = await import('js-yaml')
  return yamlDump(workflowData)
}

async function getCurrentWorkflowStateFromDb(
  workflowId: string
): Promise<{ workflowState: any; subBlockValues: Record<string, Record<string, any>> }> {
  const [workflowRecord] = await db
    .select()
    .from(workflowTable)
    .where(eq(workflowTable.id, workflowId))
    .limit(1)
  if (!workflowRecord) throw new Error(`Workflow ${workflowId} not found in database`)
  const normalized = await loadWorkflowFromNormalizedTables(workflowId)
  if (!normalized) throw new Error('Workflow has no normalized data')
  const workflowState: any = {
    blocks: normalized.blocks,
    edges: normalized.edges,
    loops: normalized.loops,
    parallels: normalized.parallels,
  }
  const subBlockValues: Record<string, Record<string, any>> = {}
  Object.entries(normalized.blocks).forEach(([blockId, block]) => {
    subBlockValues[blockId] = {}
    Object.entries((block as any).subBlocks || {}).forEach(([subId, sub]) => {
      if ((sub as any).value !== undefined) subBlockValues[blockId][subId] = (sub as any).value
    })
  })
  return { workflowState, subBlockValues }
}

export const editWorkflowServerTool: BaseServerTool<EditWorkflowParams, any> = {
  name: 'edit_workflow',
  async execute(params: EditWorkflowParams): Promise<any> {
    const logger = createLogger('EditWorkflowServerTool')
    const { operations, workflowId, currentUserWorkflow } = params
    if (!operations || operations.length === 0) throw new Error('operations are required')
    if (!workflowId) throw new Error('workflowId is required')

    logger.info('Executing edit_workflow', {
      operationCount: operations.length,
      workflowId,
      hasCurrentUserWorkflow: !!currentUserWorkflow,
    })

    const blocks = getAllBlocks()
    const blockRegistry = blocks.reduce(
      (acc, block) => {
        const blockType = (block as any).type
        ;(acc as any)[blockType] = {
          ...(block as any),
          id: blockType,
          subBlocks: (block as any).subBlocks || [],
          outputs: (block as any).outputs || {},
        }
        return acc
      },
      {} as Record<string, BlockConfig>
    )

    // Get current workflow as YAML via sim-agent
    let currentYaml: string
    {
      // Prepare workflowState and subBlockValues
      let workflowState: any | undefined
      let subBlockValues: Record<string, Record<string, any>> | undefined
      if (currentUserWorkflow) {
        try {
          workflowState = JSON.parse(currentUserWorkflow)
          // Extract subBlockValues from provided state
          subBlockValues = {}
          Object.entries(workflowState.blocks || {}).forEach(([blockId, block]: [string, any]) => {
            ;(subBlockValues as any)[blockId] = {}
            Object.entries(block.subBlocks || {}).forEach(([subId, sub]: [string, any]) => {
              if (sub?.value !== undefined) (subBlockValues as any)[blockId][subId] = sub.value
            })
          })
        } catch {}
      } else {
        const fromDb = await getCurrentWorkflowStateFromDb(workflowId)
        workflowState = fromDb.workflowState
        subBlockValues = fromDb.subBlockValues
      }

      // Log the workflow state to see if triggerMode is present
      logger.info('Workflow state being sent to sim-agent for YAML conversion:', {
        blockCount: Object.keys(workflowState.blocks || {}).length,
        blocksWithTriggerMode: Object.entries(workflowState.blocks || {})
          .filter(([_, block]: [string, any]) => block.triggerMode === true)
          .map(([id]) => id),
      })

      const resp = await fetch(`${SIM_AGENT_API_URL}/api/workflow/to-yaml`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowState,
          subBlockValues,
          blockRegistry,
          utilities: {
            generateLoopBlocks: generateLoopBlocks.toString(),
            generateParallelBlocks: generateParallelBlocks.toString(),
            resolveOutputType: resolveOutputType.toString(),
          },
        }),
      })
      if (!resp.ok) throw new Error(`Sim agent API error: ${resp.statusText}`)
      const json = await resp.json()
      if (!json.success || !json.yaml) throw new Error(json.error || 'Failed to generate YAML')
      currentYaml = json.yaml
    }

    const modifiedYaml = await applyOperationsToYaml(currentYaml, operations)

    // Convert the modified YAML back to workflow state for validation
    const validationResponse = await fetch(`${SIM_AGENT_API_URL}/api/yaml/to-workflow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        yamlContent: modifiedYaml,
        blockRegistry,
        utilities: {
          generateLoopBlocks: generateLoopBlocks.toString(),
          generateParallelBlocks: generateParallelBlocks.toString(),
          resolveOutputType: resolveOutputType.toString(),
        },
        options: { generateNewIds: false, preservePositions: true },
      }),
    })

    if (!validationResponse.ok) {
      throw new Error(`Failed to validate edited workflow: ${validationResponse.statusText}`)
    }

    const validationResult = await validationResponse.json()
    if (!validationResult.success || !validationResult.workflowState) {
      throw new Error(
        validationResult.errors?.join(', ') || 'Failed to convert edited YAML to workflow'
      )
    }

    // Validate the workflow state
    const validation = validateWorkflowState(validationResult.workflowState, { sanitize: true })

    if (!validation.valid) {
      logger.error('Edited workflow state is invalid', {
        errors: validation.errors,
        warnings: validation.warnings,
      })
      throw new Error(`Invalid edited workflow: ${validation.errors.join('; ')}`)
    }

    if (validation.warnings.length > 0) {
      logger.warn('Edited workflow validation warnings', {
        warnings: validation.warnings,
      })
    }

    logger.info('edit_workflow generated modified YAML', {
      operationCount: operations.length,
      modifiedYamlLength: modifiedYaml.length,
      validationErrors: validation.errors.length,
      validationWarnings: validation.warnings.length,
    })

    return { success: true, yamlContent: modifiedYaml }
  },
}
