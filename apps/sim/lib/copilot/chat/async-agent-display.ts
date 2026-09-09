import { isPlainRecord } from '@sim/utils/object'
import { TOOL_CATALOG } from '@/lib/copilot/generated/tool-catalog-v1'

/** Retains only bounded launch identity for labels, never the agent's task or result. */
export function compactAsyncAgentLaunch(toolName: string, output: unknown) {
  if (
    TOOL_CATALOG[toolName]?.route !== 'subagent' ||
    !isPlainRecord(output) ||
    output.async !== true ||
    output.status !== 'launched' ||
    typeof output.agentId !== 'string' ||
    !output.agentId ||
    output.agentId.length > 128 ||
    typeof output.name !== 'string' ||
    !output.name.trim() ||
    output.name.length > 256
  ) {
    return undefined
  }
  return { async: true, status: 'launched', agentId: output.agentId, name: output.name }
}
