import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'
import type { SandboxSessionRequest } from '@/lib/execution/remote-sandbox/types'
import { mintDelegationToken } from '@/lib/mothership/chat/delegation'

const logger = createLogger('MothershipSandboxSession')

/** The workbench CLI ships with Sim, so reconnect cannot silently reuse a different release. */
async function workbenchCli(): Promise<{ path: string; content: string }> {
  const cwd = process.cwd()
  const path = resolve(
    cwd,
    cwd.endsWith('/apps/sim')
      ? '../../packages/sim-cli/dist/workbench.js'
      : 'packages/sim-cli/dist/workbench.js'
  )
  const content = await readFile(path, 'utf8')
  const digest = createHash('sha256').update(content).digest('hex')
  return { path: `/home/user/.sim-cli/${digest}/cli.mjs`, content }
}

/**
 * Builds the session request for a Mothership chat's persistent sandbox: the
 * per-chat identity, the sim-CLI bootstrap, and the CLI's headless auth
 * environment (`SIM_API_KEY`/`SIM_WORKSPACE`/`SIM_ENDPOINT`, the CLI's
 * documented CI path). The token is minted sim-side per execution and injected
 * per exec instead of writing a CLI profile. Code in the workbench can access
 * its process environment; this is not a credential-isolation boundary.
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
  const cli = await workbenchCli()
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
    cli,
    ...(cliEnvs ? { envs: cliEnvs } : {}),
  }
}
