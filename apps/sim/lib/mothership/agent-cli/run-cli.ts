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
 * The chat's workbench is the agent's filesystem. The CLI calls its reader only when
 * a parsed command consumes a file; literal text, help and invalid commands do no
 * workbench I/O. The server's filesystem is never readable from model argv.
 */
export async function runCli(
  argv: string[],
  identity: EmbeddedCliIdentity,
  sessionKey: string | null
): Promise<AgentCliRawResult> {
  const readFile = sessionKey
    ? async (path: string) => {
        identity.signal?.throwIfAborted()
        const read = await readSessionSandboxFile(sessionKey, path, 'base64', identity.signal)
        identity.signal?.throwIfAborted()
        if (read.outcome === 'read') return Buffer.from(read.content, 'base64')
        throw new Error(
          read.outcome === 'no-session'
            ? `No workbench exists for this chat; write "${path}" first or pass the value inline.`
            : `Could not read workbench file "${path}": ${read.detail}`
        )
      }
    : undefined
  // Downloads land on the same machine `@path` reads from; without a sandbox session
  // the CLI refuses rather than writing to the server's disk.
  const writeFile = sessionKey
    ? async (
        path: string,
        content: ReadableStream<Uint8Array>,
        options: { overwrite: boolean }
      ) => {
        const written = await writeSessionSandboxFile(
          sessionKey,
          path,
          content,
          identity.signal,
          options
        )
        if (written.outcome !== 'written') {
          throw new Error(`Writing ${path} could not be confirmed: ${written.detail}`)
        }
      }
    : undefined
  identity.signal?.throwIfAborted()
  const result = await runEmbeddedCli(argv, identity, {
    ...(readFile ? { readFile } : {}),
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
