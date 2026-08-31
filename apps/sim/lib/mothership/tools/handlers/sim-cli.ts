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
import { applyPipeline, splitPipeline } from '@/lib/mothership/tools/handlers/sim-cli-pipe'

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
 * Root --help merges the real CLI's help with the agent-command section. A
 * trailing `| grep …` (the only pipe target) filters stdout sim-side so large
 * outputs shrink before crossing the wire.
 */
export async function executeSimCli(
  params: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const rawArgs = params.args
  if (
    !Array.isArray(rawArgs) ||
    rawArgs.length === 0 ||
    !rawArgs.every((a) => typeof a === 'string')
  ) {
    return { success: false, error: 'sim_cli requires args: a non-empty array of argv tokens.' }
  }
  if (!context.workspaceId) {
    return { success: false, error: 'sim_cli requires a workspace-scoped execution context.' }
  }
  const { cliArgs: args, stages } = splitPipeline(rawArgs)
  if (args.length === 0) {
    return { success: false, error: 'A pipe needs a sim CLI invocation before the first |.' }
  }

  // Stages are validated before the CLI runs: a mutating command must never
  // execute and then fail on a malformed pipe, or a model retry would repeat
  // the mutation.
  const stagePreflight = applyPipeline('', stages)
  if (!stagePreflight.ok) {
    return { success: false, error: stagePreflight.error }
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
        userId: context.userId,
      })
    : await runEmbeddedCli(args, identity)
  if (!agentMatch && isRootHelpInvocation(args) && result.exitCode === 0) {
    result.stdout += agentCliHelpSection()
  }
  if (result.exitCode === 0 && stages.length > 0) {
    const piped = applyPipeline(result.stdout, stages)
    if (piped.ok) result.stdout = piped.stdout
  }

  logger.info('CLI invocation finished', {
    exitCode: result.exitCode,
    argv0: args[0],
    lane: agentMatch ? 'agent' : 'cli',
    grepStages: stages.length,
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
