/**
 * Deployment declarations: `deployments/<workflow key>.ts` in a workspace source directory deploys
 * `workflows/<workflow key>/`, so its schedule, webhook, API and chat triggers run.
 *
 * ```ts
 * // @sim-sdk 1
 * import { defineDeployment, env } from '@sim/workflow-sdk/workspace'
 *
 * export default defineDeployment({
 *   live: 'draft',
 *   chat: {
 *     identifier: 'support',
 *     title: 'Support',
 *     auth: { password: env.SUPPORT_CHAT_PASSWORD },
 *     outputs: [{ block: 'Answer', path: 'content' }],
 *   },
 * })
 * ```
 *
 * An apply deploys after it writes the workflows. Removing the file undeploys the workflow, which
 * stops its schedules, webhooks, API and chat, and needs `--allow-delete`. Deploying needs a
 * workspace admin and is refused to a workspace API key. Publishing to an MCP server is not part
 * of source.
 */
import type { EnvRef } from '@sim/workflow-sdk'

export { env, stored } from '@sim/workflow-sdk'

/** Who may open a chat. */
export type ChatAuth =
  | 'public'
  /**
   * A password from an environment variable, by name, never the value itself; or `stored()`, the
   * password the chat already stores (valid only for a chat that has one).
   */
  | { password: EnvRef }
  /** These emails (or `@domain.com` patterns), signing in with a code. */
  | { emails: string[] }
  /** These emails (or `@domain.com` patterns), signing in through the workspace's SSO. */
  | { sso: string[] }

/** One output a chat answers with. */
export interface ChatOutput {
  /** The block's name, as the workflow names it. */
  block: string
  /** The output path on that block (`content`, `result.text`). */
  path: string
}

/** The chat a deployment serves. */
export interface ChatDeployment {
  /** The chat's URL path segment, unique across the platform. */
  identifier: string
  title: string
  description?: string
  auth: ChatAuth
  outputs?: ChatOutput[]
  /** The chat's look; an omitted field takes the platform default. */
  customizations?: { primaryColor?: string; welcomeMessage?: string; imageUrl?: string }
  /** Show the model's thinking to clients that ask for it. */
  includeThinking?: boolean
  /** Show tool calls to clients that ask for them. */
  includeToolCalls?: boolean
}

/** A deployment declaration. */
export interface DeploymentDeclaration {
  /**
   * `'draft'`: an apply deploys the draft whenever it differs from the live version (after this
   * apply's workflow edits), as long as it holds only what the workflow folder declares: a draft
   * edited outside source is not deployed, and the apply warns. `'pinned'`: an apply never
   * redeploys, and says when the draft differs.
   */
  live: 'draft' | 'pinned'
  /** Public: anyone may run the workflow's API without a key. Private when omitted. */
  api?: { public?: boolean }
  /** The chat the deployment serves; none when omitted. */
  chat?: ChatDeployment
}

/** Declares a workflow's deployment. Its default export is the whole file. */
export declare function defineDeployment(deployment: DeploymentDeclaration): DeploymentDeclaration
