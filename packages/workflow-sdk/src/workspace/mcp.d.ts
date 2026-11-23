/**
 * MCP server declarations: `mcp/<key>.ts` declares one server the workspace's agents call tools
 * on.
 *
 * ```ts
 * // @sim-sdk 1
 * import { defineMcpServer, env } from '@sim/workflow-sdk/workspace'
 *
 * export default defineMcpServer({
 *   name: 'GitHub',
 *   url: 'https://api.githubcopilot.com/mcp/',
 *   headers: { Authorization: 'Bearer {{GITHUB_TOKEN}}', 'X-Team': env.GITHUB_TEAM },
 * })
 * ```
 *
 * A workflow names the server by its key and one of its tools by name:
 * `mcp('github').tool('create_issue')`. Secrets never sit in source: a credential header
 * (`Authorization`, `Cookie`, or a name with `key`, `token`, `secret`, `auth`, …) holds env
 * references (`env.NAME`, or `{{NAME}}` in its text after a scheme such as `Bearer`) or
 * `stored()`, which keeps the value the server holds. The server's id derives from its URL, so a
 * `url` with another host or path replaces the server; a new query string updates it in place.
 */
import type { EnvRef } from '@sim/workflow-sdk'

export { env, stored } from '@sim/workflow-sdk'

/** A header value: text (`{{NAME}}` names an env variable), `env.NAME`, or `stored()`. */
export type McpHeaderValue = string | EnvRef

/** How the server authenticates. */
export interface McpServerAuth {
  /** `headers` (the default) sends the declared headers; `oauth` signs in with an OAuth grant. */
  type: 'none' | 'headers' | 'oauth'
  /** A pre-registered OAuth client, for a server without dynamic client registration. */
  clientId?: string
}

/** An MCP server declaration. */
export interface McpServerDeclaration {
  /** The display name; the key when left out. */
  name?: string
  description?: string
  /** An `http://` or `https://` URL. A new host or path replaces the server; a new query does not. */
  url: string
  transport?: 'streamable-http'
  headers?: { [name: string]: McpHeaderValue }
  /** `{ type: 'headers' }` when left out. The OAuth client secret is set in the server settings. */
  auth?: McpServerAuth
  /** Milliseconds a request waits; 30000 when left out. */
  timeout?: number
  /** 3 when left out. */
  retries?: number
  /** `true` when left out. */
  enabled?: boolean
}

/** Declares an MCP server. Its default export is the whole file. */
export declare function defineMcpServer(server: McpServerDeclaration): McpServerDeclaration
