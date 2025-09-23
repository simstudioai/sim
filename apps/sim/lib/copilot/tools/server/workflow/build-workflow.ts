import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import type { BuildWorkflowInput, BuildWorkflowResult } from '@/lib/copilot/tools/shared/schemas'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { SIM_AGENT_API_URL_DEFAULT } from '@/lib/sim-agent'
import { validateWorkflowState } from '@/lib/workflows/validation'
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
        throw new Error(conversionResult.errors?.join(', ') || 'Failed to convert YAML to workflow')
      }

      const workflowState = conversionResult.workflowState

      // Validate the workflow state before returning
      const validation = validateWorkflowState(workflowState, { sanitize: true })

      if (!validation.valid) {
        logger.error('Generated workflow state is invalid', {
          errors: validation.errors,
          warnings: validation.warnings,
        })
        throw new Error(`Invalid workflow: ${validation.errors.join('; ')}`)
      }

      if (validation.warnings.length > 0) {
        logger.warn('Workflow validation warnings', {
          warnings: validation.warnings,
        })
      }

      // Use sanitized state if available
      const finalWorkflowState = validation.sanitizedState || workflowState

      // Apply positions using smart layout
      const positionResponse = await fetch(`${SIM_AGENT_API_URL}/api/yaml/apply-layout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowState: finalWorkflowState,
          options: {
            strategy: 'smart',
            direction: 'auto',
            spacing: {
              horizontal: 500,
              vertical: 400,
              layer: 700,
            },
            alignment: 'center',
            padding: {
              x: 250,
              y: 250,
            },
          },
        }),
      })

      if (!positionResponse.ok) {
        const errorText = await positionResponse.text().catch(() => '')
        logger.warn('Failed to apply layout to workflow', {
          status: positionResponse.status,
          error: errorText,
        })
        // Non-critical error - continue with unpositioned workflow
      } else {
        const layoutResult = await positionResponse.json()
        if (layoutResult.success && layoutResult.workflowState) {
          // Update the workflow state with positioned blocks
          Object.assign(finalWorkflowState, layoutResult.workflowState)
        }
      }

      return {
        success: true,
        workflowState: finalWorkflowState,
        yamlContent,
        message: `Successfully built workflow with ${Object.keys(finalWorkflowState.blocks).length} blocks`,
        description: description || 'Built workflow',
      }
    } catch (error: any) {
      logger.error('Error building workflow', error)
      throw error
    }
  },
}
