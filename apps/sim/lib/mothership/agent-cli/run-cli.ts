import { type EmbeddedCliIdentity, runEmbeddedCli } from 'sim/embed'
import type { SessionFileObserver } from '@/lib/execution/remote-sandbox/session-file-observer'
import { openSessionFileSnapshot } from '@/lib/execution/remote-sandbox/session-file-snapshot'
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
  sessionKey: string | null,
  files?: { observeDownload: SessionFileObserver; observeUpload: SessionFileObserver }
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
        const written = await writeSessionSandboxFile(sessionKey, path, content, identity.signal, {
          ...options,
          ...(files ? { observe: files.observeDownload } : {}),
        })
        if (written.outcome !== 'written') {
          throw new Error(`Writing ${path} could not be confirmed: ${written.detail}`)
        }
      }
    : undefined
  const openFile = sessionKey
    ? (path: string) =>
        openSessionFileSnapshot(sessionKey, path, identity.signal, files?.observeUpload)
    : undefined
  identity.signal?.throwIfAborted()
  return runEmbeddedCli(argv, identity, {
    ...(readFile ? { readFile } : {}),
    ...(openFile ? { openFile } : {}),
    ...(writeFile ? { writeFile } : {}),
  })
}
