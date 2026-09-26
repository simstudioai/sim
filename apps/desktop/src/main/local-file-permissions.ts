import { lstat, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isDesktopScopeId } from '@sim/desktop-bridge'
import type { BrowserWindow } from 'electron'
import { showShellDialog } from '@/main/dialogs'
import type { LocalFileAuthorization } from '@/main/local-files'

const MAX_GRANTS = 256
const MAX_PENDING_REQUESTS = 32

interface LocalFilePermissionContext {
  parent: BrowserWindow
  origin: string
  generation: number
  isCurrent: () => boolean
  revalidate: () => Promise<boolean>
}

interface LocalFileGrant {
  scope: string
  path: string
  directory: boolean
  dev: number
  ino: number
}

export interface LocalFileAccess {
  path: string
  resolve: (path: string) => Promise<string>
}

function nativePath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096 || value.includes('\0'))
    throw new Error('A native absolute path or ~/ path is required.')
  const path =
    value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value
  if (!isAbsolute(path)) throw new Error('Use an absolute path or ~/ path.')
  return resolve(path)
}

function contains(grant: LocalFileGrant, path: string): boolean {
  if (path === grant.path) return true
  if (!grant.directory) return false
  const rel = relative(grant.path, path)
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}

function assertCurrent(context: LocalFilePermissionContext): void {
  if (context.parent.isDestroyed() || !context.isCurrent())
    throw new Error('This local file request expired. Ask again in the current chat.')
}

/** Chat grants live only in this desktop session and are never writable by the hosted renderer. */
export class LocalFilePermissions {
  private grants: LocalFileGrant[] = []
  private generation = -1
  private queue: Promise<void> = Promise.resolve()
  private pending = 0

  async authorize(
    authorization: LocalFileAuthorization & { chatId: string },
    context: LocalFilePermissionContext
  ): Promise<LocalFileAccess> {
    if (this.pending >= MAX_PENDING_REQUESTS)
      throw new Error('Too many local file requests are waiting for permission. Try again later.')
    const wasQueued = this.pending > 0
    this.pending++
    const pending = this.queue.then(() => this.authorizeNext(authorization, context, wasQueued))
    this.queue = pending.then(
      () => undefined,
      () => undefined
    )
    try {
      return await pending
    } finally {
      this.pending--
    }
  }

  private async authorizeNext(
    authorization: LocalFileAuthorization & { chatId: string },
    context: LocalFilePermissionContext,
    wasQueued: boolean
  ): Promise<LocalFileAccess> {
    assertCurrent(context)
    if (this.generation !== context.generation) {
      this.grants = []
      this.generation = context.generation
    }
    const importing = authorization.toolName === 'import_local_files'
    if (
      importing &&
      (!isDesktopScopeId(authorization.args.targetWorkspaceId) ||
        (authorization.args.folderId !== undefined &&
          !isDesktopScopeId(authorization.args.folderId)))
    )
      throw new Error('A valid destination workspace and folder are required for imports.')
    const scope = JSON.stringify([
      context.origin,
      authorization.chatId,
      authorization.toolName,
      ...(importing ? [authorization.args.targetWorkspaceId, authorization.args.folderId] : []),
    ])
    const path = await realpath(nativePath(authorization.args.path))
    const info = await stat(path)
    if (!info.isFile() && !info.isDirectory())
      throw new Error('The path is not a regular file or directory.')
    let grant = this.grants.find((entry) => entry.scope === scope && contains(entry, path))
    if (grant) {
      if (wasQueued && !(await context.revalidate()))
        throw new Error('This local file tool call is no longer pending or its arguments changed.')
      const root = await lstat(grant.path)
      if (root.dev !== grant.dev || root.ino !== grant.ino || root.isSymbolicLink()) {
        this.grants = this.grants.filter((entry) => entry !== grant)
        grant = undefined
      }
    }
    if (!grant) {
      if (this.grants.length >= MAX_GRANTS)
        throw new Error(
          'Restart Sim to clear this session’s local file permissions before adding more.'
        )
      assertCurrent(context)
      const kind = info.isDirectory() ? 'folder' : 'file'
      const displayedPath = JSON.stringify(path).replace(
        /[\u202a-\u202e\u2066-\u2069]/g,
        (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
      )
      const result = await showShellDialog(context.parent, {
        title: importing ? `Import this ${kind}?` : `Read this ${kind}?`,
        message: displayedPath,
        detail: [
          importing
            ? `Sim will upload this ${kind}${info.isDirectory() ? ' and its contents' : ''} to your workspace on ${context.origin}.`
            : `Sim will read this ${kind}${info.isDirectory() ? ' and its contents' : ''} and send the results to ${context.origin} for this chat.`,
          ...(importing ? [`Destination workspace: ${authorization.args.targetWorkspaceId}`] : []),
          'This permission applies only to this chat and ends when Sim closes.',
        ].join('\n\n'),
        buttons: ['Allow for this chat', "Don't allow"],
        defaultId: 1,
        cancelId: 1,
      })
      assertCurrent(context)
      if (result.response !== 0) throw new Error('The user did not allow this local file access.')
      if (!(await context.revalidate()))
        throw new Error('This local file tool call is no longer pending or its arguments changed.')
      grant = { scope, path, directory: info.isDirectory(), dev: info.dev, ino: info.ino }
      await this.resolve(grant, path, context)
      this.grants.push(grant)
    }
    await this.resolve(grant, path, context)
    const approvedGrant = grant
    return { path, resolve: (candidate) => this.resolve(approvedGrant, candidate, context) }
  }

  private async resolve(
    grant: LocalFileGrant,
    candidate: string,
    context: LocalFilePermissionContext
  ): Promise<string> {
    assertCurrent(context)
    const root = await lstat(grant.path)
    if (
      root.dev !== grant.dev ||
      root.ino !== grant.ino ||
      (grant.directory ? !root.isDirectory() : !root.isFile())
    )
      throw new Error('The approved file or folder changed. Ask again to request access.')
    const path = await realpath(candidate)
    if (!contains(grant, path)) throw new Error('This path is outside the approved file or folder.')
    assertCurrent(context)
    return path
  }
}
