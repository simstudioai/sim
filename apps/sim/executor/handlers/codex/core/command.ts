/** Safe command construction for the pinned Codex sandbox runtime. */

import {
  type CodexModel,
  type CodexReasoningEffort,
  parseCodexModel,
  parseCodexReasoningEffort,
} from '@/providers/codex'

export type { CodexModel, CodexReasoningEffort } from '@/providers/codex'
export {
  CODEX_CLI_VERSION,
  CODEX_MODELS,
  CODEX_REASONING_EFFORTS,
  DEFAULT_CODEX_MODEL,
  parseCodexModel,
  parseCodexReasoningEffort,
} from '@/providers/codex'

export const CODEX_HOME_DIR = '/workspace/.sim-codex-home'
export const CODEX_REPO_DIR = '/workspace/repo'
export const CODEX_PROMPT_PATH = '/workspace/codex-prompt.txt'

/** Stable features excluded from the workflow-managed Codex runtime. */
export const CODEX_DISABLED_FEATURES = [
  'hooks',
  'multi_agent',
  'apps',
  'tool_suggest',
  'plugins',
  'remote_plugin',
  'plugin_sharing',
  'skill_mcp_dependency_install',
  'skill_search',
  'guardian_approval',
  'goals',
] as const

/** Non-secret environment paired with the fixed Codex command. */
export interface CodexExecCommand {
  command: string
  envs: {
    CODEX_HOME: string
    CODEX_MODEL: CodexModel
    CODEX_REASONING_EFFORT: CodexReasoningEffort
    CODEX_NETWORK_ACCESS: 'true' | 'false'
    CODEX_THREAD_ID?: string
  }
}

/**
 * Builds a command whose shell source never contains user-controlled text.
 * The task is written separately to {@link CODEX_PROMPT_PATH}; validated model
 * settings travel as provider SDK environment values and stay quoted.
 *
 * Codex exec 0.146.0 forces `approval_policy=never` for headless runs in
 * `codex-rs/exec/src/lib.rs`. The command additionally ignores user config and
 * execpolicy rules. Its shell policy is explicit because that Codex version's
 * default inherits the full parent environment, including `OPENAI_API_KEY`.
 */
export function buildCodexExecCommand(options: {
  model: unknown
  reasoningEffort?: unknown
  networkAccess?: boolean
  threadId?: string
}): CodexExecCommand {
  const model = parseCodexModel(options.model)
  const reasoningEffort = parseCodexReasoningEffort(options.reasoningEffort)
  const disabledFeatureArgs = CODEX_DISABLED_FEATURES.map(
    (feature) => `  -c 'features.${feature}=false'`
  ).join('\n')

  const command = `/bin/bash -o pipefail -s <<'__SIM_CODEX_EXEC__'
set -euo pipefail
if [ -n "\${CODEX_THREAD_ID:-}" ]; then
  if [ ! -d "$CODEX_HOME/sessions" ]; then
    echo "Codex session state is missing for thread $CODEX_THREAD_ID" >&2
    exit 1
  fi
else
  rm -rf "$CODEX_HOME"
  install -d -m 700 "$CODEX_HOME"
fi

args=(
  --json
  --color never
  --ignore-user-config
  --ignore-rules
  --strict-config
  --cd ${CODEX_REPO_DIR}
  --model "$CODEX_MODEL"
  --sandbox workspace-write
  -c 'shell_environment_policy.inherit="core"'
  -c 'shell_environment_policy.ignore_default_excludes=false'
  -c "model_reasoning_effort=\"$CODEX_REASONING_EFFORT\""
  -c "sandbox_workspace_write.network_access=$CODEX_NETWORK_ACCESS"
${disabledFeatureArgs}
)

if [ -n "\${CODEX_THREAD_ID:-}" ]; then
  exec codex exec "\${args[@]}" resume "$CODEX_THREAD_ID" - < ${CODEX_PROMPT_PATH}
fi
exec codex exec "\${args[@]}" - < ${CODEX_PROMPT_PATH}
__SIM_CODEX_EXEC__`

  return {
    command,
    envs: {
      CODEX_HOME: CODEX_HOME_DIR,
      CODEX_MODEL: model,
      CODEX_REASONING_EFFORT: reasoningEffort,
      CODEX_NETWORK_ACCESS: options.networkAccess ? 'true' : 'false',
      ...(options.threadId ? { CODEX_THREAD_ID: options.threadId } : {}),
    },
  }
}
