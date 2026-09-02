import { type EmbeddedCliIdentity, runEmbeddedCli } from 'sim/embed'
import { readSessionSandboxFile } from '@/lib/execution/remote-sandbox/session-files'
import type { AgentCliRawResult } from '@/lib/mothership/generated/agent-cli'

/**
 * Runs one real-CLI invocation in-process through the installed CLI's own command tree,
 * against this deployment's internal API base with the caller's delegated identity.
 *
 * The chat's workbench sandbox is the agent's filesystem: every @-shaped token is
 * pre-read from it into a map the embedded CLI's OWN argument resolver consults — so
 * only genuinely file-aware flags get file semantics (a literal `--text @channel` stays
 * literal), and the server's filesystem is never readable from model argv. A token that
 * names no sandbox file is simply absent from the map; the resolver's refusal says so.
 */
export async function runCli(
  argv: string[],
  identity: EmbeddedCliIdentity,
  sessionKey: string | null
): Promise<AgentCliRawResult> {
  const fileArguments: Record<string, string> = {}
  if (sessionKey) {
    for (const token of argv) {
      if (!token.startsWith('@') || token.startsWith('@@') || token === '@-') continue
      const path = token.slice(1)
      if (fileArguments[path] !== undefined) continue
      const read = await readSessionSandboxFile(sessionKey, path)
      if (read.outcome === 'read') fileArguments[path] = read.content
    }
  }
  return runEmbeddedCli(argv, identity, { fileArguments })
}
