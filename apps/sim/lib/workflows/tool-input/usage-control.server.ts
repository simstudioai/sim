import { isRecordLike } from '@sim/utils/object'
import type { BlockState } from '@sim/workflow-types/workflow'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getAgentToolUsageControlMode } from '@/lib/workflows/tool-input/usage-control'

/** Gates variable tool permissions before a workflow graph is saved or accepted by a dry run. */
export async function assertAgentToolPermissionModeEnabled(
  blocks: Iterable<Pick<BlockState, 'type' | 'subBlocks' | 'data'>>
): Promise<void> {
  for (const block of blocks) {
    if (block.type !== 'agent') continue
    const tools = block.subBlocks?.tools?.value
    if (!Array.isArray(tools)) continue

    const hasVariableMode = tools.some(
      (tool, index) =>
        getAgentToolUsageControlMode(index, block.data?.canonicalModes) === 'advanced' ||
        (isRecordLike(tool) && tool.usageControlExpression !== undefined)
    )
    if (!hasVariableMode) continue

    if (!(await isFeatureEnabled('agent-tool-permission-mode'))) {
      throw new OrchestrationError(
        'validation',
        'Variable agent tool permission modes are disabled'
      )
    }
    return
  }
}
