import { enginePrincipal } from '@/lib/mothership/agent-cli/engine-principal'
import { type AgentCliEngine, agentCliFail, agentCliOk } from '@/lib/mothership/agent-cli/types'
import { readCopilotWorkflowRunOptions } from '@/lib/workflows/application/read-workflow-copilot-metadata'

/** Describe every draft entrypoint through the existing authorized workflow read. */
export const workflowInputsCommand: AgentCliEngine = {
  openReadResources: true,
  async execute(positionals, runtime) {
    const [workflowId] = positionals
    if (!workflowId) return agentCliFail('Usage: sim workflows inputs <workflowId>')
    const principal = enginePrincipal(runtime, readCopilotWorkflowRunOptions)
    if (!principal) return agentCliFail('Workspace authentication is unavailable.')
    const result = await readCopilotWorkflowRunOptions.execute({
      principal,
      input: { workflowId, assertedWorkspaceId: runtime.workspaceId },
    })
    return agentCliOk(JSON.stringify({ workflowId, version: 'draft', ...result }, null, 2))
  },
}
