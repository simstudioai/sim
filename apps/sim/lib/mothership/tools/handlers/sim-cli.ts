import { createLogger } from '@sim/logger'
import { createEmbeddedClient, type EmbeddedCliIdentity, runEmbeddedCli } from 'sim/embed'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { mintDelegationToken } from '@/lib/mothership/chat/delegation'
import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from '@/lib/mothership/tool-executor/types'
import {
  agentCliHelpSection,
  executeAgentCliCommand,
  isRootHelpInvocation,
  matchAgentCliCommand,
} from '@/lib/mothership/tools/handlers/agent-cli'

const logger = createLogger('MothershipSimCli')

/**
 * Executes one Sim CLI invocation in-process — the worker's `sim_cli` tool
 * defers here instead of spawning a CLI binary in its own container.
 *
 * Routing: agent-only augmentations (agent-cli/) intercept first and answer
 * from typed v2 calls; everything else runs through the installed CLI's own
 * command tree (`sim/embed`) against this deployment's internal API base. Both
 * lanes share one server-minted delegation identity for the calling user, so
 * "the agent is the user" holds without any credential crossing to the worker.
 * Root --help merges the real CLI's help with the agent-command section.
 */
export async function executeSimCli(
  params: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const args = params.args
  if (!Array.isArray(args) || args.length === 0 || !args.every((a) => typeof a === 'string')) {
    return { success: false, error: 'sim_cli requires args: a non-empty array of argv tokens.' }
  }
  if (!context.workspaceId) {
    return { success: false, error: 'sim_cli requires a workspace-scoped execution context.' }
  }

  const apiKey = await mintDelegationToken({
    workspaceId: context.workspaceId,
    userId: context.userId,
  })
  if (!apiKey) {
    return { success: false, error: 'Could not establish workspace credentials for this command.' }
  }
  const identity: EmbeddedCliIdentity = {
    endpoint: getInternalApiBaseUrl(),
    apiKey,
    workspaceId: context.workspaceId,
  }

  const agentMatch = matchAgentCliCommand(args)
  const result = agentMatch
    ? await executeAgentCliCommand(agentMatch, {
        client: createEmbeddedClient(identity),
        workspaceId: context.workspaceId,
      })
    : await runEmbeddedCli(args, identity)
  if (!agentMatch && isRootHelpInvocation(args) && result.exitCode === 0) {
    result.stdout += agentCliHelpSection()
  }

  logger.info('CLI invocation finished', {
    exitCode: result.exitCode,
    argv0: args[0],
    lane: agentMatch ? 'agent' : 'cli',
    stdoutBytes: result.stdout.length,
  })
  // The worker folds exitCode/stdout/stderr into the model window and applies
  // its own output capping; success here means only "the invocation ran".
  return {
    success: result.exitCode === 0,
    output: { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },
    ...(result.exitCode === 0
      ? {}
      : { error: result.stderr.split('\n')[0] || `sim CLI exited with code ${result.exitCode}` }),
  }
}
