import type { WorkflowState } from '@sim/workflow-types/workflow'
import { fetchWorkflowState } from '@/lib/mothership/tools/handlers/agent-cli/commands/workflow-views'
import {
  type AgentCliCommand,
  agentCliFail,
  agentCliOk,
} from '@/lib/mothership/tools/handlers/agent-cli/types'
import { formatWorkflowLintMessage, hasWorkflowLintIssues } from '@/lib/workflows/editing/lint'
import { buildWorkflowLintReport } from '@/lib/workflows/editing/lint-report'

/**
 * The Go copilot served this as the virtual `workflows/{path}/lint.json` VFS
 * file; here it is a command. Authorization rides the v2 export fetch (a user
 * who cannot read the workflow gets the 403 there); the report itself is the
 * same engine both graph writes publish, so a lint here can never disagree
 * with what an edit would have reported.
 */
export const workflowLintCommand: AgentCliCommand = {
  path: ['workflow', 'lint'],
  summary: 'Validate one workflow: orphans, unwired ports, missing fields, unresolved references',
  usage: 'workflow lint <workflowId>',
  async execute(rest, runtime) {
    const workflowId = rest[0]
    if (!workflowId) return agentCliFail('Usage: sim workflow lint <workflowId>')
    const state = await fetchWorkflowState(runtime, workflowId)
    // double-cast-allowed: the v2 export's `state` is the serialized WorkflowState;
    // the lint engine reads it structurally (blocks/edges only)
    const graph = state as unknown as Pick<WorkflowState, 'blocks' | 'edges'>
    const report = await buildWorkflowLintReport(graph, {
      workflowId,
      workspaceId: runtime.workspaceId,
      subjectUserId: runtime.userId,
    })
    const summary = hasWorkflowLintIssues(report)
      ? formatWorkflowLintMessage(report)
      : 'No lint issues found.'
    return agentCliOk(JSON.stringify({ summary, ...report }, null, 2))
  },
}
