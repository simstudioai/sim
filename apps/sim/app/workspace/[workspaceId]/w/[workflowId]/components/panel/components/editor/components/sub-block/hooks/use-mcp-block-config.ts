import { isPlainRecord } from '@sim/utils/object'
import { resolveMcpBlockConfig } from '@/lib/mcp/workflow-config'
import type { CanonicalModeOverrides } from '@/lib/workflows/subblocks/visibility'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { resolvePreviewContextValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/utils'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

interface UseMcpBlockConfigProps {
  blockId: string
  previewContextValues?: Record<string, unknown>
}

/** Reads the active MCP fields consistently in the editor and workflow previews. */
export function useMcpBlockConfig({ blockId, previewContextValues }: UseMcpBlockConfigProps) {
  const [serverSelector] = useSubBlockValue<unknown>(blockId, 'serverSelector')
  const [serverReference] = useSubBlockValue<unknown>(blockId, 'serverReference')
  const [toolSelector] = useSubBlockValue<unknown>(blockId, 'toolSelector')
  const [toolReference] = useSubBlockValue<unknown>(blockId, 'toolReference')
  const modes = useWorkflowStore((state) => state.blocks[blockId]?.data?.canonicalModes)
  const values = previewContextValues
    ? Object.fromEntries(
        Object.entries(previewContextValues).map(([key, value]) => [
          key,
          resolvePreviewContextValue(value),
        ])
      )
    : { serverSelector, serverReference, toolSelector, toolReference }
  const isBaselineView = useWorkflowDiffStore(
    (state) => state.hasActiveDiff && !state.isShowingDiff
  )
  const baselineModes = useWorkflowDiffStore(
    (state) => state.baselineWorkflow?.blocks[blockId]?.data?.canonicalModes
  )
  const effectiveModes = previewContextValues
    ? isPlainRecord(previewContextValues.__canonicalModes)
      ? (previewContextValues.__canonicalModes as CanonicalModeOverrides)
      : undefined
    : isBaselineView
      ? baselineModes
      : modes
  return resolveMcpBlockConfig(values, effectiveModes)
}
