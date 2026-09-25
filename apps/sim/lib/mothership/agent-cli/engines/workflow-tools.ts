import { enginePrincipal } from '@/lib/mothership/agent-cli/engine-principal'
import { type AgentCliEngine, agentCliFail, agentCliOk } from '@/lib/mothership/agent-cli/types'
import { messageForCopilotApplicationError } from '@/lib/mothership/application/error'
import { inspectWorkflowTools } from '@/lib/workflows/application/inspect-workflow-tools'

export const workflowToolsCommand: AgentCliEngine = {
  async execute([workflowId], runtime, flags) {
    if (!workflowId || typeof flags.block !== 'string' || !flags.block.trim())
      return agentCliFail('Usage: sim workflows tools <workflowId> --block <blockId>')
    const principal = enginePrincipal(runtime, inspectWorkflowTools)
    if (!principal) return agentCliFail('Workspace authentication is unavailable.')
    try {
      const report = await inspectWorkflowTools.execute({
        principal,
        input: {
          workflowId,
          blockId: flags.block,
          assertedWorkspaceId: runtime.workspaceId,
          ...(typeof flags.query === 'string' ? { query: flags.query } : {}),
          ...(typeof flags.limit === 'string' ? { limit: Number(flags.limit) } : {}),
          signal: runtime.signal,
        },
      })
      return agentCliOk(JSON.stringify(report, null, 2))
    } catch (error) {
      if (runtime.signal?.aborted) return agentCliFail('Tool inspection was cancelled.')
      return agentCliFail(
        messageForCopilotApplicationError(
          error,
          'Tool inspection could not complete. Retry before relying on this report.'
        )
      )
    }
  },
}
