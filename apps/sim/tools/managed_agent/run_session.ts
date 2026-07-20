import type {
  ManagedAgentRunSessionOutput,
  ManagedAgentRunSessionParams,
} from '@/tools/managed_agent/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

/**
 * Client-safe half of the Managed Agent tool.
 *
 * The Sim tools registry is walked from client-side code (schema
 * inspection, block editor UI). This module MUST NOT statically import
 * any server-only code (`@sim/db`, encryption, drizzle, our
 * `session-client` HTTP module). Even a lazy `import()` statically ties
 * this module to the server graph and Turbopack transitively pulls
 * `postgres` → `fs`/`net`/`tls` into the client bundle, which fails.
 *
 * Instead, the actual execution lives in `./run_session.server.ts`
 * (which imports `@sim/db` freely). At server boot that module
 * self-registers a `ManagedAgentServerImpl` via
 * `registerManagedAgentServerImpl()` below. `directExecution` looks up
 * the registered impl on `globalThis` at call time — Turbopack sees no
 * cross-boundary edge.
 *
 * On the client the impl is never registered, so `directExecution`
 * returns a clear error. In practice the tool is never invoked from the
 * browser, so that branch is defensive only.
 */

export type ManagedAgentServerImpl = (
  params: ManagedAgentRunSessionParams
) => Promise<ToolResponse>

const GLOBAL_KEY = '__simManagedAgentServerImpl' as const
type ImplHolder = { [GLOBAL_KEY]?: ManagedAgentServerImpl }

/**
 * Registered from `apps/sim/tools/managed_agent/server.ts` (server-only)
 * at server boot via a side-effect import in a server file. See
 * `apps/sim/tools/managed_agent/register-server.ts`.
 */
export function registerManagedAgentServerImpl(impl: ManagedAgentServerImpl): void {
  ;(globalThis as unknown as ImplHolder)[GLOBAL_KEY] = impl
}

function getServerImpl(): ManagedAgentServerImpl | undefined {
  return (globalThis as unknown as ImplHolder)[GLOBAL_KEY]
}

export const managedAgentRunSessionTool: ToolConfig<
  ManagedAgentRunSessionParams,
  ToolResponse
> = {
  id: 'managed_agent_run_session',
  name: 'Managed Agent Run Session',
  description:
    'Open a Claude Platform Managed Agent session and return the assistant response as text.',
  version: '1.0.0',

  params: {
    connection: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ID of the linked Claude Platform workspace (Managed Agent connection).',
    },
    agent: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Managed-agent id inside the selected workspace.',
    },
    environment: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Environment id inside the selected workspace.',
    },
    environmentType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: "Environment config type — 'cloud' or 'self_hosted'.",
    },
    vaults: {
      type: 'array',
      required: false,
      visibility: 'user-only',
      description: 'Zero or more vault ids for MCP tool auth.',
    },
    memoryStoreId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Optional Agent Memory Store id.',
    },
    memoryAccess: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: "Access mode: 'read_write' (default) or 'read_only'.",
    },
    files: {
      type: 'array',
      required: false,
      visibility: 'user-only',
      description:
        'File attachments (cloud envs only). Array of `{fileId, mountPath?}` — Anthropic mounts each into the session container.',
    },
    sessionParameters: {
      type: 'object',
      required: false,
      visibility: 'user-only',
      description:
        'Session metadata (top-level `metadata` on the wire). On self-hosted envs the self-hosted agent sandbox exposes each key as an env var; on cloud envs metadata is stored as opaque tags.',
    },
    userMessage: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The user message to send to the Managed Agent.',
    },
  },

  directExecution: async (params: ManagedAgentRunSessionParams): Promise<ToolResponse> => {
    const impl = getServerImpl()
    if (!impl) {
      return {
        success: false,
        output: {} satisfies Partial<ManagedAgentRunSessionOutput>,
        error:
          'Managed Agent server impl is not registered. This tool must be invoked from a Sim workflow execution on the server.',
      }
    }
    return impl(params)
  },

  request: {
    url: () => 'https://api.anthropic.com/v1/sessions',
    method: 'POST',
    headers: () => ({}),
  },

  outputs: {
    content: { type: 'string', description: 'Final assistant text from the Managed Agent session.' },
    sessionId: { type: 'string', description: 'Anthropic session id (for logs / linking).' },
  },
}
