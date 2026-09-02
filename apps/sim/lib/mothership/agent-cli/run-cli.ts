import { type EmbeddedCliIdentity, runEmbeddedCli } from 'sim/embed'
import {
  readSessionSandboxFile,
  writeSessionSandboxFile,
} from '@/lib/execution/remote-sandbox/session-files'
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
  // Downloads land on the same machine `@path` reads from; without a sandbox session
  // the CLI refuses rather than writing to the server's disk.
  const writeFile = sessionKey
    ? async (path: string, content: Uint8Array) =>
        (await writeSessionSandboxFile(sessionKey, path, Buffer.from(content).toString('utf8')))
          .outcome === 'written'
    : undefined
  const result = await runEmbeddedCli(argv, identity, {
    fileArguments,
    ...(writeFile ? { writeFile } : {}),
  })
  return { ...result, stdout: stripAnsi(result.stdout), stderr: stripAnsi(result.stderr) }
}

const ANSI_SEQUENCE = /\[[0-9;?]*[ -/]*[@-~]/g

/**
 * The CLI colours its notes with chalk, which keys off the HOSTING server's TTY — so an
 * embedded run on a dev server hands the model `[2m…[22m` around every
 * truncation notice. The model reads text, never a terminal: strip escapes on the way out.
 */
function stripAnsi(text: string): string {
  return text.replace(ANSI_SEQUENCE, '')
}
