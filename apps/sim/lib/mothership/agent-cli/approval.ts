import { resolveEmbeddedCliCommand, type V2OperationName } from 'sim/embed'
import { AgentCliRequest } from '@/lib/mothership/generated/agent-cli'
import {
  CallIntegrationTool,
  CancelWorkflowRun,
  DeleteWorkspaceMcpServer,
  DeployAsApi,
  DeployAsChat,
  DeployAsMcp,
  PromoteToLive,
  RunWorkflow,
  TOOL_CATALOG,
  type ToolCatalogEntry,
} from '@/lib/mothership/generated/tool-catalog-v1'

/**
 * The catalog tool whose capability each v2 operation is. The worker retired these
 * tools in favour of `sim_cli`, so a command that calls one of these operations answers
 * to that tool's approval flag: one policy, whichever name the capability arrives under.
 * The deploy tools gate undeploy as well, so both directions map to them; rollback runs
 * the same use case as activating a version.
 */
const CATALOG_TOOL_BY_OPERATION: Partial<Record<V2OperationName, ToolCatalogEntry>> = {
  activateWorkflowVersion: PromoteToLive,
  rollbackWorkflow: PromoteToLive,
  deployWorkflow: DeployAsApi,
  undeployWorkflow: DeployAsApi,
  replaceWorkflowChatDeployment: DeployAsChat,
  deleteWorkflowChatDeployment: DeployAsChat,
  deployWorkflowMcpTool: DeployAsMcp,
  undeployWorkflowMcpTool: DeployAsMcp,
  deleteWorkflowMcpServer: DeleteWorkspaceMcpServer,
  executeWorkflow: RunWorkflow,
  resumeWorkflow: RunWorkflow,
  cancelWorkflowRun: CancelWorkflowRun,
  executeTool: CallIntegrationTool,
}

/**
 * Whether a `sim_cli` call must be held for the user's decision. Its argv is resolved by
 * the CLI's own parser, so the answer is about the command that would run, and a `--yes`
 * in that argv answers only the CLI's prompt, never this one. Argv the parser cannot
 * follow is held; a malformed request is not, because `executeSimCli` refuses it.
 */
export function cliRequestRequiresApproval(request: unknown): boolean {
  const parsed = AgentCliRequest.safeParse(request)
  if (!parsed.success) return false
  const { invocation } = parsed.data
  if (invocation.kind === 'service') return TOOL_CATALOG[invocation.name]?.requiresApproval === true
  if (invocation.kind !== 'cli') return false
  const command = resolveEmbeddedCliCommand(invocation.argv)
  if (command === undefined) return true
  return (
    command?.operations.some(
      (operation) => CATALOG_TOOL_BY_OPERATION[operation]?.requiresApproval === true
    ) === true
  )
}

/**
 * The tool name (`cli_workflows_deploy`) of the command a `sim_cli` call would run, as the
 * CLI's parser resolves it. The row's own name is the worker's reading of the same argv;
 * an always-allow saved under that name covers the call only when the two agree, so a
 * row named for one command, or for no command at all, never carries another's consent.
 */
export function cliCommandToolName(request: unknown): string | undefined {
  const parsed = AgentCliRequest.safeParse(request)
  if (!parsed.success || parsed.data.invocation.kind !== 'cli') return undefined
  const command = resolveEmbeddedCliCommand(parsed.data.invocation.argv)
  return command ? `cli_${command.path.join('_').replace(/-/g, '_')}` : undefined
}
