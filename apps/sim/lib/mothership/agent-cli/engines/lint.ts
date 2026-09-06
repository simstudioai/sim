import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { type AgentCliEngine, agentCliFail, agentCliOk } from '@/lib/mothership/agent-cli/types'
import { readWorkflowLint } from '@/lib/workflows/application/read-workflow-lint'
import { formatWorkflowLintMessage, hasWorkflowLintIssues } from '@/lib/workflows/editing/lint'

const logger = createLogger('WorkflowLintCommand')

/** The application owns protected diagnostic reads; the command presents its complete report. */
export const workflowLintCommand: AgentCliEngine = {
  async execute(rest, runtime) {
    const workflowId = rest[0]
    if (!workflowId) return agentCliFail('Usage: sim workflows lint <workflowId>')
    if (!runtime.principal) {
      return agentCliFail('Workspace authentication is unavailable. Retry the diagnostic.')
    }
    try {
      const report = await readWorkflowLint.execute({
        principal: runtime.principal,
        input: { workflowId, signal: runtime.signal },
      })
      const findings = [...report.notes]
      if (hasWorkflowLintIssues(report)) findings.unshift(formatWorkflowLintMessage(report))
      if (report.undeclaredEnvVars.length > 0) {
        findings.push(
          `Referenced secrets are not visible to this caller: ${report.undeclaredEnvVars.map((v) => v.name).join(', ')}. Check the intended execution identity and secret scope before running.`
        )
      }
      const summary =
        findings.length > 0
          ? findings.join(' ')
          : 'No issues found in supported static checks. Code, external resources and runtime behaviour are not verified.'
      return agentCliOk(JSON.stringify({ summary, ...report }, null, 2))
    } catch (error) {
      if (runtime.signal?.aborted) return agentCliFail('Workflow lint was cancelled.')
      if (
        error instanceof OrchestrationError &&
        (error.code === 'forbidden' || error.code === 'not_found')
      ) {
        return agentCliFail('Workflow not found or not accessible.')
      }
      logger.warn('Workflow diagnostic failed', { error: getErrorMessage(error) })
      return agentCliFail(
        'Workflow lint could not complete. Retry the diagnostic before relying on it.'
      )
    }
  },
}
