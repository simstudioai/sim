import { lstat, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { isDesktopScopeId } from '@sim/desktop-bridge'
import type { BrowserWindow } from 'electron'
import { showShellDialog } from '@/main/dialogs'
import type { LocalFileAuthorization } from '@/main/local-files'
import type { LocalFileAccess, LocalFilesystemService } from '@/main/local-filesystem'

const MAX_PENDING_REQUESTS = 32

interface LocalFilePermissionContext {
  parent: BrowserWindow
  origin: string
  generation: number
  isCurrent: () => boolean
  revalidate: () => Promise<boolean>
}

function nativePath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096 || value.includes('\0'))
    throw new Error('A native absolute path or ~/ path is required.')
  const path =
    value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value
  if (!isAbsolute(path)) throw new Error('Use an absolute path or ~/ path.')
  return resolve(path)
}

function assertCurrent(context: LocalFilePermissionContext): void {
  if (context.parent.isDestroyed() || !context.isCurrent())
    throw new Error('This local file request expired. Ask again in the current chat.')
}

async function revalidate(context: LocalFilePermissionContext): Promise<void> {
  assertCurrent(context)
  if (!(await context.revalidate()))
    throw new Error('This local file tool call is no longer pending or its arguments changed.')
  assertCurrent(context)
}

/** Serializes new consent prompts while remembered folder access remains concurrent. */
export class LocalFilePermissions {
  private queue: Promise<void> = Promise.resolve()
  private pending = 0

  constructor(private readonly filesystem: LocalFilesystemService) {}

  async authorize(
    authorization: LocalFileAuthorization,
    context: LocalFilePermissionContext
  ): Promise<LocalFileAccess> {
    assertCurrent(context)
    if (
      authorization.toolName === 'import_local_files' &&
      (!isDesktopScopeId(authorization.args.targetWorkspaceId) ||
        (authorization.args.folderId !== undefined &&
          !isDesktopScopeId(authorization.args.folderId)))
    )
      throw new Error('A valid destination workspace and folder are required for imports.')
    const path = await realpath(nativePath(authorization.args.path))
    const existing = await this.filesystem.nativeAccess(path)
    if (existing) return this.authorizedAccess(existing, context)
    if (this.pending >= MAX_PENDING_REQUESTS)
      throw new Error('Too many local file requests are waiting for permission. Try again later.')
    this.pending++
    const pending = this.queue.then(() => this.requestFolder(path, context))
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

  private async requestFolder(
    path: string,
    context: LocalFilePermissionContext
  ): Promise<LocalFileAccess> {
    await revalidate(context)
    const existing = await this.filesystem.nativeAccess(path)
    if (existing) return this.authorizedAccess(existing, context)
    const info = await stat(path)
    if (!info.isFile() && !info.isDirectory())
      throw new Error('The path is not a regular file or directory.')
    const folder = info.isDirectory() ? path : dirname(path)
    const root = await lstat(folder)
    if (!root.isDirectory()) throw new Error('The folder is no longer available.')
    const displayedPath = JSON.stringify(folder).replace(
      /[\u202a-\u202e\u2066-\u2069]/g,
      (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
    )
    assertCurrent(context)
    const result = await showShellDialog(context.parent, {
      title: 'Allow access to this folder?',
      message: displayedPath,
      detail: `Sim can read files in this folder and its subfolders, use them across chats, and import them into your workspaces on ${context.origin}.\n\nManage or remove access in File → Folder Access.`,
      buttons: ['Allow folder', "Don't allow"],
      defaultId: 1,
      cancelId: 1,
    })
    assertCurrent(context)
    if (result.response !== 0) throw new Error('The user did not allow this local file access.')
    await revalidate(context)
    await this.filesystem.grantDirectory({ path: folder }, context.generation, root)
    const access = await this.filesystem.nativeAccess(path)
    if (!access) throw new Error('The approved folder is no longer available.')
    return this.authorizedAccess(access, context)
  }

  private async authorizedAccess(
    access: LocalFileAccess,
    context: LocalFilePermissionContext
  ): Promise<LocalFileAccess> {
    await revalidate(context)
    const resolveApproved = async (path: string): Promise<string> => {
      assertCurrent(context)
      const resolved = await access.resolve(path)
      assertCurrent(context)
      return resolved
    }
    await resolveApproved(access.path)
    return { path: access.path, resolve: resolveApproved }
  }
}
