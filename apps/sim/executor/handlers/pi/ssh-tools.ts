/**
 * SSH-backed file and shell tools for local-mode Pi runs. A single `ssh2`
 * connection is opened per run and reused across every tool call: `read`/`write`/
 * `edit` go over SFTP, `bash` over a shell exec scoped to the repo directory.
 * All paths are sanitized and confined to the configured `repoPath` (S4).
 */

import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { Client, SFTPWrapper } from 'ssh2'
import {
  createSSHConnection,
  escapeShellArg,
  executeSSHCommand,
  sanitizeCommand,
  sanitizePath,
} from '@/app/api/tools/ssh/utils'
import type { PiSshConnection, PiToolResult, PiToolSpec } from '@/executor/handlers/pi/backend'

const logger = createLogger('PiSshTools')

/** An open SSH session reused for the duration of a local Pi run. */
export interface PiSshSession {
  client: Client
  sftp: SFTPWrapper
  close: () => void
}

/** Opens one SSH connection plus an SFTP channel for the run. */
export async function openSshSession(connection: PiSshConnection): Promise<PiSshSession> {
  const client = await createSSHConnection({
    host: connection.host,
    port: connection.port,
    username: connection.username,
    password: connection.password ?? null,
    privateKey: connection.privateKey ?? null,
    passphrase: connection.passphrase ?? null,
  })

  const close = () => {
    try {
      client.end()
    } catch (error) {
      logger.warn('Failed to close SSH session', { error: getErrorMessage(error) })
    }
  }

  // The TCP/SSH connection is already open here, so close it if opening the SFTP
  // channel fails (e.g. the server has the SFTP subsystem disabled) — otherwise
  // the connection is orphaned when this function throws.
  try {
    const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
      client.sftp((err, channel) => (err ? reject(err) : resolve(channel)))
    })
    return { client, sftp, close }
  } catch (error) {
    close()
    throw error
  }
}

function readRemoteFile(sftp: SFTPWrapper, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    sftp.readFile(path, (err, data) => (err ? reject(err) : resolve(data.toString('utf-8'))))
  })
}

function writeRemoteFile(sftp: SFTPWrapper, path: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.writeFile(path, content, (err) => (err ? reject(err) : resolve()))
  })
}

/** Resolves a tool-supplied path against `repoPath`, rejecting traversal/escape. */
function resolveRepoPath(repoPath: string, candidate: string): string {
  const clean = sanitizePath(candidate)
  const root = repoPath.replace(/\/+$/, '')
  if (clean.startsWith('/')) {
    if (clean !== root && !clean.startsWith(`${root}/`)) {
      throw new Error(`Path is outside the repository: ${candidate}`)
    }
    return clean
  }
  return `${root}/${clean}`
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

async function guard(run: () => Promise<PiToolResult>): Promise<PiToolResult> {
  try {
    return await run()
  } catch (error) {
    return { text: getErrorMessage(error, 'SSH tool failed'), isError: true }
  }
}

/**
 * Best-effort working-tree snapshot of the repo over the run's SSH session, for
 * the block's `changedFiles`/`diff` outputs — Local mode edits in place rather
 * than opening a PR. `changedFiles` covers both tracked modifications and untracked
 * (newly created) files so files the agent created are reported; `diff` reflects
 * tracked changes against HEAD. Returns empty on any failure (not a git repo, git
 * missing, non-zero exit).
 */
export async function captureRepoChanges(
  session: PiSshSession,
  repoPath: string,
  maxDiffBytes: number
): Promise<{ changedFiles: string[]; diff: string }> {
  const scoped = `cd '${escapeShellArg(repoPath)}'`
  try {
    const tracked = await executeSSHCommand(
      session.client,
      `${scoped} && git diff --name-only HEAD`
    )
    const untracked = await executeSSHCommand(
      session.client,
      `${scoped} && git ls-files --others --exclude-standard`
    )
    const fileSet = new Set<string>()
    for (const result of [tracked, untracked]) {
      if (result.exitCode !== 0) continue
      for (const line of result.stdout.split('\n')) {
        const file = line.trim()
        if (file) fileSet.add(file)
      }
    }
    const raw = await executeSSHCommand(session.client, `${scoped} && git diff HEAD`)
    const out = raw.exitCode === 0 ? raw.stdout : ''
    const diff = out.length > maxDiffBytes ? `${out.slice(0, maxDiffBytes)}\n[diff truncated]` : out
    return { changedFiles: [...fileSet], diff }
  } catch {
    return { changedFiles: [], diff: '' }
  }
}

/** Builds the SSH-backed `read`/`write`/`edit`/`bash` tools scoped to `repoPath`. */
export function buildSshToolSpecs(session: PiSshSession, repoPath: string): PiToolSpec[] {
  const { client, sftp } = session

  return [
    {
      name: 'read',
      description: 'Read the full contents of a file in the repository.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'File path within the repository' } },
        required: ['path'],
      },
      execute: (args) =>
        guard(async () => {
          const path = asString(args.path)
          if (!path) return { text: 'path is required', isError: true }
          const content = await readRemoteFile(sftp, resolveRepoPath(repoPath, path))
          return { text: content, isError: false }
        }),
    },
    {
      name: 'write',
      description: 'Write (create or overwrite) a file in the repository.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path within the repository' },
          content: { type: 'string', description: 'Full file contents to write' },
        },
        required: ['path', 'content'],
      },
      execute: (args) =>
        guard(async () => {
          const path = asString(args.path)
          if (!path) return { text: 'path is required', isError: true }
          const resolved = resolveRepoPath(repoPath, path)
          await writeRemoteFile(sftp, resolved, asString(args.content))
          return { text: `Wrote ${resolved}`, isError: false }
        }),
    },
    {
      name: 'edit',
      description: 'Replace the first occurrence of old_string with new_string in a file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path within the repository' },
          old_string: { type: 'string', description: 'Exact text to replace' },
          new_string: { type: 'string', description: 'Replacement text' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
      execute: (args) =>
        guard(async () => {
          const path = asString(args.path)
          if (!path) return { text: 'path is required', isError: true }
          const oldString = asString(args.old_string)
          const resolved = resolveRepoPath(repoPath, path)
          const current = await readRemoteFile(sftp, resolved)
          if (!current.includes(oldString)) {
            return { text: `old_string not found in ${resolved}`, isError: true }
          }
          const updated = current.replace(oldString, asString(args.new_string))
          await writeRemoteFile(sftp, resolved, updated)
          return { text: `Edited ${resolved}`, isError: false }
        }),
    },
    {
      name: 'bash',
      description: 'Run a shell command in the repository directory and return its output.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'Shell command to run' } },
        required: ['command'],
      },
      execute: (args) =>
        guard(async () => {
          const command = asString(args.command)
          if (!command) return { text: 'command is required', isError: true }
          const scoped = `cd '${escapeShellArg(repoPath)}' && ${sanitizeCommand(command)}`
          const result = await executeSSHCommand(client, scoped)
          const text = [result.stdout, result.stderr].filter(Boolean).join('\n')
          return {
            text: text || `Exited with code ${result.exitCode}`,
            isError: result.exitCode !== 0,
          }
        }),
    },
  ]
}
