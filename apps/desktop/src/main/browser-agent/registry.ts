import type { WebContents } from 'electron'

/**
 * Registry of WebContents that belong to the agent browser (the browser-agent
 * session's tabs). The global security guards consult this to swap the
 * app-origin navigation policy for the agent policy (free http/https
 * browsing) on exactly these contents and nothing else.
 *
 * Registration happens right after a view is constructed; the guards check at
 * navigation time, so the post-construction registration races nothing.
 */
const agentContents = new WeakSet<WebContents>()

export function registerAgentWebContents(contents: WebContents): void {
  agentContents.add(contents)
}

export function isAgentWebContents(contents: WebContents): boolean {
  return agentContents.has(contents)
}
