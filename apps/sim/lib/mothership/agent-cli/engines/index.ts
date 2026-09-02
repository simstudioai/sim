import { getErrorMessage } from '@sim/utils/errors'
import { workflowDepsCommand } from '@/lib/mothership/agent-cli/engines/deps'
import { filesGrepCommand } from '@/lib/mothership/agent-cli/engines/files-grep'
import { workflowGrepCommand, workflowsGrepCommand } from '@/lib/mothership/agent-cli/engines/grep'
import { workflowLintCommand } from '@/lib/mothership/agent-cli/engines/lint'
import { logsQueryCommand } from '@/lib/mothership/agent-cli/engines/query'
import { workflowTraceCommand } from '@/lib/mothership/agent-cli/engines/trace'
import {
  workflowBlocksCommand,
  workflowEdgesCommand,
} from '@/lib/mothership/agent-cli/engines/workflow-views'
import {
  type AgentCliEngine,
  type AgentCliFlags,
  type AgentCliResult,
  type AgentCliRuntime,
  agentCliFail,
} from '@/lib/mothership/agent-cli/types'

/**
 * Every augmentation engine, keyed by the worker's canonical command name. The worker's
 * registry (grammar/augmentations.ts) and this map must agree exactly — the worker's
 * augmentation-drift check reads these keys.
 */
export const AUGMENTATION_ENGINES: Readonly<Record<string, AgentCliEngine>> = {
  'files grep': filesGrepCommand,
  'logs query': logsQueryCommand,
  'workflow blocks': workflowBlocksCommand,
  'workflow deps': workflowDepsCommand,
  'workflow edges': workflowEdgesCommand,
  'workflow grep': workflowGrepCommand,
  'workflow lint': workflowLintCommand,
  'workflow trace': workflowTraceCommand,
  'workflows grep': workflowsGrepCommand,
}

/** Runs one engine by the worker's name; an engine that throws yields a failed result, never a throw. */
export async function runEngine(
  name: string,
  positionals: string[],
  runtime: AgentCliRuntime,
  flags: AgentCliFlags
): Promise<AgentCliResult> {
  const engine = AUGMENTATION_ENGINES[name]
  if (!engine) return agentCliFail(`No engine for agent command "${name}".`)
  try {
    return await engine.execute(positionals, runtime, flags)
  } catch (error) {
    return agentCliFail(getErrorMessage(error))
  }
}
