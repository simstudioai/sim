import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'
import type { SandboxSessionRequest } from '@/lib/execution/remote-sandbox/types'
import { mintDelegationToken } from '@/lib/mothership/chat/delegation'

const logger = createLogger('MothershipSandboxSession')

/**
 * The per-chat sandbox identity. One constructor: the key doubles as the E2B lease key
 * AND the workbench file-bridge scope, so two hand-built copies drifting apart would
 * silently split a chat across two machines.
 */
export function chatSandboxSessionKey(chatId: string): string {
  return `mothership-chat:${chatId}`
}

/**
 * Installed once per fresh session sandbox until the mothership images bake the
 * CLI in. `command -v` keeps the install one-time: a sandbox that already has
 * the binary skips straight through.
 */
const SESSION_BOOTSTRAP_COMMAND =
  'command -v sim >/dev/null 2>&1 || npm install -g sim --no-fund --no-audit --loglevel=error'

/**
 * Builds the session request for a Mothership chat's persistent sandbox: the
 * per-chat identity, the sim-CLI bootstrap, and the CLI's headless auth
 * environment (`SIM_API_KEY`/`SIM_WORKSPACE`/`SIM_ENDPOINT`, the CLI's
 * documented CI path). The token is minted sim-side per execution and injected
 * per exec, so a stopped or reaped sandbox never holds a live credential and
 * nothing crosses to the worker.
 *
 * Both failure modes degrade rather than fail the execution: without a token or
 * a reachable endpoint the sandbox still persists — only `sim` inside it is
 * unauthenticated.
 */
export async function buildMothershipSandboxSession(args: {
  sessionKey: string
  workspaceId: string
  userId: string
}): Promise<SandboxSessionRequest> {
  let cliEnvs: Record<string, string> | undefined
  try {
    const apiKey = await mintDelegationToken({
      workspaceId: args.workspaceId,
      userId: args.userId,
    })
    const endpoint = env.MOTHERSHIP_SANDBOX_CLI_ENDPOINT?.trim() || getBaseUrl()
    if (apiKey) {
      cliEnvs = {
        SIM_API_KEY: apiKey,
        SIM_WORKSPACE: args.workspaceId,
        SIM_ENDPOINT: endpoint,
      }
    }
  } catch (error) {
    logger.warn('Session sandbox CLI environment unavailable', {
      workspaceId: args.workspaceId,
      error: getErrorMessage(error),
    })
  }
  return {
    key: args.sessionKey,
    bootstrapCommand: SESSION_BOOTSTRAP_COMMAND,
    ...(cliEnvs ? { envs: cliEnvs } : {}),
  }
}
