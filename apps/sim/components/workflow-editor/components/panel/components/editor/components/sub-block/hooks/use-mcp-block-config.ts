import { isPlainRecord } from '@sim/utils/object'
import { useSubBlockValue } from '@/components/workflow-editor/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { resolvePreviewContextValue } from '@/components/workflow-editor/components/panel/components/editor/components/sub-block/utils'
import { resolveMcpBlockConfig } from '@/lib/mcp/workflow-config'
import type { CanonicalModeOverrides } from '@/lib/workflows/subblocks/visibility'
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
  const effectiveModes = previewContextValues
    ? isPlainRecord(previewContextValues.__canonicalModes)
      ? (previewContextValues.__canonicalModes as CanonicalModeOverrides)
      : undefined
    : modes
  return resolveMcpBlockConfig(values, effectiveModes)
}
