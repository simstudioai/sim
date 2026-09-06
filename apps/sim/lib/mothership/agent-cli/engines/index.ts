import { getErrorMessage } from '@sim/utils/errors'
import { workflowDepsCommand } from '@/lib/mothership/agent-cli/engines/deps'
import { docsSearchCommand } from '@/lib/mothership/agent-cli/engines/docs-search'
import { fileViewCommand } from '@/lib/mothership/agent-cli/engines/file-view'
import { workflowLintCommand } from '@/lib/mothership/agent-cli/engines/lint'
import { logsQueryCommand } from '@/lib/mothership/agent-cli/engines/query'
import { universalGrepCommand } from '@/lib/mothership/agent-cli/engines/universal-grep'
import {
  type AgentCliEngine,
  type AgentCliFlags,
  type AgentCliResult,
  type AgentCliRuntime,
  agentCliFail,
} from '@/lib/mothership/agent-cli/types'

/**
 * Every sim-executed augmentation engine, keyed by the worker's canonical command name.
 * The worker's registry (grammar/augmentations.ts) and this map must agree exactly —
 * the worker's augmentation-drift check reads these keys. Worker-answered commands
 * (blocks tips, outputs get, integrations list) never reach this map.
 */
export const AUGMENTATION_ENGINES: Readonly<Record<string, AgentCliEngine>> = {
  'files view': fileViewCommand,
  'docs search': docsSearchCommand,
  grep: universalGrepCommand,
  'logs query': logsQueryCommand,
  'workflows deps': workflowDepsCommand,
  'workflows lint': workflowLintCommand,
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
