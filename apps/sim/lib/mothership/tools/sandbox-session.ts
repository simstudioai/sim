import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { env } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'
import type { SandboxSessionRequest } from '@/lib/execution/remote-sandbox/types'
import { WorkbenchBootstrap } from '@/lib/mothership/generated/workbench'
import { fetchGo } from '@/lib/mothership/request/go/fetch'
import { mothershipRequestHeaders } from '@/lib/mothership/request/headers'
import { getMothershipBaseURL } from '@/lib/mothership/server/agent-url'
import { sandboxResourceEndpoint } from '@/lib/mothership/tools/sandbox-resources'
import { getSimConnection } from '@/lib/mothership/transport/connection'

const logger = createLogger('MothershipSandboxSession')

/** Public runtime and private bootstrap share an immutable release directory. */
async function workbenchCli(
  userId: string,
  signal?: AbortSignal
): Promise<NonNullable<SandboxSessionRequest['cli']>> {
  const cwd = process.cwd()
  const path = resolve(
    cwd,
    cwd.endsWith('/apps/sim')
      ? '../../packages/sim-cli/dist/runtime.js'
      : 'packages/sim-cli/dist/runtime.js'
  )
  signal?.throwIfAborted()
  const runtime = await readFile(path, 'utf8')
  const baseURL = await getMothershipBaseURL({ userId })
  const deadline = AbortSignal.timeout(15_000)
  const response = await fetchGo(`${baseURL}/api/workbench/bootstrap`, {
    headers: mothershipRequestHeaders(),
    redirect: 'error',
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    spanName: 'sim → worker /api/workbench/bootstrap',
    operation: 'workbench_bootstrap',
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error('Mothership workbench bootstrap is unavailable')
  }
  const { entrypoint } = WorkbenchBootstrap.parse(await response.json())
  signal?.throwIfAborted()
  const digest = createHash('sha256')
    .update(JSON.stringify([runtime, entrypoint]))
    .digest('hex')
  const directory = `/home/user/.sim-cli/${digest}`
  return {
    path: `${directory}/cli.mjs`,
    content: entrypoint,
    runtime: { path: `${directory}/runtime.mjs`, content: runtime },
  }
}

/**
 * Builds the session request for a Mothership chat's persistent sandbox: the
 * per-chat identity, the sim-CLI bootstrap, and the CLI's headless auth
 * environment (`SIM_API_KEY`/`SIM_WORKSPACE`/`SIM_ENDPOINT`, the CLI's
 * documented CI path). Only an opaque callback credential enters the workbench;
 * the active tool lease resolves the real user credential on the server. The
 * opaque credential cannot authenticate directly to ordinary v2 routes.
 *
 * Both failure modes degrade rather than fail the execution: without a token or
 * a reachable endpoint the sandbox still persists — only `sim` inside it is
 * unauthenticated.
 */
export async function buildMothershipSandboxSession(args: {
  sessionKey: string
  workspaceId?: string
  organizationId?: string
  userId: string
  signal?: AbortSignal
}): Promise<SandboxSessionRequest> {
  args.signal?.throwIfAborted()
  if (getSimConnection().mode === 'checkpoint') return { key: args.sessionKey }
  const cli = await workbenchCli(args.userId, args.signal)
  let cliEnvs: Record<string, string> | undefined
  try {
    const apiKey = `mothership-sandbox:${generateId()}`
    const endpoint = env.MOTHERSHIP_SANDBOX_CLI_ENDPOINT?.trim() || getBaseUrl()
    const scopedEndpoint = await sandboxResourceEndpoint(endpoint, args, apiKey)
    if (scopedEndpoint !== endpoint) {
      cliEnvs = {
        SIM_API_KEY: apiKey,
        ...(args.organizationId
          ? { SIM_ORGANIZATION_ID: args.organizationId }
          : { SIM_WORKSPACE: args.workspaceId! }),
        SIM_ENDPOINT: scopedEndpoint,
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
