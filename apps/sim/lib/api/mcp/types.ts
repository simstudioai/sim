import type { AnyApiRouteContract } from '@/lib/api/contracts/types'

/** One v2 operation as the Sim MCP server exposes it; entries are generated from the contracts. */
export interface V2McpOperation {
  readonly contract: AnyApiRouteContract
  /** The OpenAPI summary, when the operation has one. */
  readonly summary?: string
  /** The OpenAPI description: behavior, constraints, and caveats beyond the summary. */
  readonly description?: string
  /** The operation refuses workspace API keys; a personal credential is required. */
  readonly workspaceKeyUnsupported?: true
  /** Loads the route handler that serves this operation over HTTP. */
  readonly handler: () => Promise<unknown>
}
