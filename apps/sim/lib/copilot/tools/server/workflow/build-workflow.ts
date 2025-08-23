import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { type BuildWorkflowInput, BuildWorkflowResult } from '@/lib/copilot/tools/shared/schemas'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { SIM_AGENT_API_URL_DEFAULT } from '@/lib/sim-agent'
import { getAllBlocks } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { resolveOutputType } from '@/blocks/utils'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'

const SIM_AGENT_API_URL = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT

export const buildWorkflowServerTool: BaseServerTool<
  ReturnType<typeof BuildWorkflowInput.parse>,
  ReturnType<typeof BuildWorkflowResult.parse>
> = {
  name: 'build_workflow',
  async execute({
    yamlContent,
    description,
  }: ReturnType<typeof BuildWorkflowInput.parse>): Promise<
    ReturnType<typeof BuildWorkflowResult.parse>
  > {
    const logger = createLogger('BuildWorkflowServerTool')
    logger.info('Building workflow for copilot', {
      yamlLength: yamlContent.length,
      description,
    })

    try {
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

      const response = await fetch(`${SIM_AGENT_API_URL}/api/yaml/to-workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          yamlContent,
          blockRegistry,
          utilities: {
            generateLoopBlocks: generateLoopBlocks.toString(),
            generateParallelBlocks: generateParallelBlocks.toString(),
            resolveOutputType: resolveOutputType.toString(),
          },
          options: { generateNewIds: true, preservePositions: false },
        }),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new Error(`Sim agent API error: ${response.statusText}`)
      }

      const conversionResult = await response.json()

      if (!conversionResult.success || !conversionResult.workflowState) {
        logger.error('YAML conversion failed', {
          errors: conversionResult.errors,
          warnings: conversionResult.warnings,
        })
        return BuildWorkflowResult.parse({
          success: false,
          message: `Failed to convert YAML workflow: ${Array.isArray(conversionResult.errors) ? conversionResult.errors.join(', ') : 'Unknown errors'}`,
          yamlContent,
          description,
        })
      }

      const { workflowState } = conversionResult

      const previewWorkflowState = {
        blocks: {} as Record<string, any>,
        edges: [] as any[],
        loops: {} as Record<string, any>,
        parallels: {} as Record<string, any>,
        lastSaved: Date.now(),
        isDeployed: false,
      }

      const blockIdMapping = new Map<string, string>()
      Object.keys(workflowState.blocks).forEach((blockId: string) => {
        const previewId = `preview-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
        blockIdMapping.set(blockId, previewId)
      })

      for (const [originalId, block] of Object.entries(workflowState.blocks)) {
        const previewBlockId = blockIdMapping.get(originalId as string)!
        const typedBlock = block as any
        ;(previewWorkflowState.blocks as any)[previewBlockId] = {
          ...typedBlock,
          id: previewBlockId,
          position: typedBlock.position || { x: 0, y: 0 },
          enabled: true,
        }
      }

      ;(previewWorkflowState as any).edges = (workflowState.edges as any[]).map((edge: any) => ({
        ...edge,
        id: `edge-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        source: blockIdMapping.get(edge.source) || edge.source,
        target: blockIdMapping.get(edge.target) || edge.target,
      }))

      const blocksCount = Object.keys((previewWorkflowState as any).blocks).length
      const edgesCount = (previewWorkflowState as any).edges.length

      logger.info('Workflow built successfully', { blocksCount, edgesCount })

      return BuildWorkflowResult.parse({
        success: true,
        message: `Successfully built workflow with ${blocksCount} blocks and ${edgesCount} connections`,
        yamlContent,
        description: description || 'Built workflow',
        workflowState: previewWorkflowState,
        data: { blocksCount, edgesCount },
      })
    } catch (error: any) {
      logger.error('Failed to build workflow:', error)
      return BuildWorkflowResult.parse({
        success: false,
        message: `Workflow build failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        yamlContent,
        description,
      })
    }
  },
}
