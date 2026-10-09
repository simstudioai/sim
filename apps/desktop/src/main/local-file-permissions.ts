import { lstat, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { isDesktopScopeId } from '@sim/desktop-bridge'
import type { BrowserWindow } from 'electron'
import { showShellDialog } from '@/main/dialogs'
import type { LocalFileAuthorization } from '@/main/local-files'
import type { LocalFileAccess, LocalFilesystemService } from '@/main/local-filesystem'
import { openNativeFile } from '@/main/native-directory'

const MAX_PENDING_REQUESTS = 32

interface LocalFilePermissionContext {
  parent: () => Promise<BrowserWindow | null>
  origin: string
  generation: number
  signal: AbortSignal
  isCurrent: () => boolean
  revalidate: () => Promise<boolean>
}

interface PendingFolderDecision {
  contexts: Set<LocalFilePermissionContext>
  controller: AbortController
  decision: Promise<void>
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
  context.signal.throwIfAborted()
  if (!context.isCurrent())
    throw new Error('This local file request expired. Ask again in the current chat.')
}

async function revalidate(context: LocalFilePermissionContext): Promise<void> {
  assertCurrent(context)
  if (!(await context.revalidate()))
    throw new Error('This local file tool call is no longer pending or its arguments changed.')
  assertCurrent(context)
}

/** Shares each pending folder decision while remembered access remains concurrent. */
export class LocalFilePermissions {
  private queue: Promise<void> = Promise.resolve()
  private readonly pending = new Map<string, PendingFolderDecision>()

  constructor(
    private readonly filesystem: LocalFilesystemService,
    private readonly fullFileAccess: () => boolean = () => false,
    private readonly enableFullFileAccess?: () => void
  ) {}

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
    if (this.fullFileAccess()) {
      return this.unrestrictedAccess(path, context)
    }
    const existing = await this.filesystem.nativeAccess(path)
    if (existing) return this.authorizedAccess(existing, context)
    const info = await stat(path)
    if (!info.isFile() && !info.isDirectory())
      throw new Error('The path is not a regular file or directory.')
    const folder = info.isDirectory() ? path : dirname(path)
    const key = JSON.stringify([context.generation, context.origin, folder])
    let pending = this.pending.get(key)
    if (pending?.controller.signal.aborted) pending = undefined
    if (!pending) {
      if (this.pending.size >= MAX_PENDING_REQUESTS)
        throw new Error('Too many local file requests are waiting for permission. Try again later.')
      const contexts = new Set<LocalFilePermissionContext>()
      const controller = new AbortController()
      const decision = this.queue.then(() =>
        this.requestFolder(folder, contexts, controller.signal)
      )
      this.queue = decision.then(
        () => undefined,
        () => undefined
      )
      const request = { contexts, controller, decision }
      pending = request
      this.pending.set(key, request)
      void this.queue.then(() => {
        if (this.pending.get(key) === request) this.pending.delete(key)
      })
    }
    pending.contexts.add(context)
    await this.waitForDecision(pending, context)
    if (this.fullFileAccess()) return this.unrestrictedAccess(path, context)
    const access = await this.filesystem.nativeAccess(path)
    if (!access) throw new Error('The approved folder is no longer available.')
    return this.authorizedAccess(access, context)
  }

  private async unrestrictedAccess(
    path: string,
    context: LocalFilePermissionContext
  ): Promise<LocalFileAccess> {
    const info = await stat(path)
    const folder = info.isDirectory() ? path : dirname(path)
    const identity = await stat(folder, { bigint: true })
    return this.authorizedAccess(
      {
        path,
        resolve: realpath,
        open: (requested, directory = false) =>
          openNativeFile(folder, relative(folder, requested), identity, directory),
      },
      { ...context, isCurrent: () => context.isCurrent() && this.fullFileAccess() }
    )
  }

  private waitForDecision(
    pending: PendingFolderDecision,
    context: LocalFilePermissionContext
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const leave = () => {
        context.signal.removeEventListener('abort', cancel)
        pending.contexts.delete(context)
        if (pending.contexts.size === 0) pending.controller.abort()
      }
      const cancel = () => {
        leave()
        reject(context.signal.reason)
      }
      context.signal.addEventListener('abort', cancel, { once: true })
      pending.decision.then(
        () => {
          leave()
          resolve()
        },
        (error) => {
          leave()
          reject(error)
        }
      )
      if (context.signal.aborted) cancel()
    })
  }

  private async currentContext(
    contexts: Set<LocalFilePermissionContext>,
    signal: AbortSignal
  ): Promise<LocalFilePermissionContext> {
    signal.throwIfAborted()
    for (const context of contexts) {
      try {
        await revalidate(context)
        if (contexts.has(context)) return context
      } catch {
        signal.throwIfAborted()
      }
    }
    throw new Error('The local file requests are no longer pending. Ask again in the current chat.')
  }

  private async requestFolder(
    folder: string,
    contexts: Set<LocalFilePermissionContext>,
    signal: AbortSignal
  ): Promise<void> {
    const context = await this.currentContext(contexts, signal)
    if (this.fullFileAccess() || (await this.filesystem.nativeAccess(folder))) return
    const root = await lstat(folder, { bigint: true })
    if (!root.isDirectory()) throw new Error('The folder is no longer available.')
    const displayedPath = JSON.stringify(folder).replace(
      /\p{Bidi_Control}/gu,
      (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
    )
    signal.throwIfAborted()
    const parent = await context.parent()
    await this.currentContext(contexts, signal)
    const options = {
      signal,
      title: 'Allow access to this folder?',
      message: displayedPath,
      detail: `Sim can read and import files from this folder and its subfolders across chats on ${context.origin}.\n\nManage access in File → Folder Access.`,
      buttons: [
        'Allow folder',
        "Don't allow",
        ...(this.enableFullFileAccess ? ['Allow all files…'] : []),
      ],
      defaultId: 1,
      cancelId: 1,
    }
    while (true) {
      await this.currentContext(contexts, signal)
      const result = await (parent ? showShellDialog(parent, options) : showShellDialog(options))
      signal.throwIfAborted()
      if (result.response === 2 && this.enableFullFileAccess) {
        const confirmation = {
          signal,
          title: 'Allow full file access?',
          message: `Sim can read and import files from any folder on this computer across chats on ${context.origin}.`,
          detail: 'Turn this off in Settings → Desktop → Full file access.',
          buttons: ['Allow all files', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
        }
        const answer = await (parent
          ? showShellDialog(parent, confirmation)
          : showShellDialog(confirmation))
        await this.currentContext(contexts, signal)
        if (answer.response !== 0) continue
        this.enableFullFileAccess()
        return
      }
      if (result.response !== 0) throw new Error('The user did not allow this local file access.')
      const current = await this.currentContext(contexts, signal)
      await this.filesystem.grantDirectory({ path: folder }, current.generation, root)
      return
    }
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
    return {
      path: access.path,
      resolve: resolveApproved,
      open: async (path, directory) => {
        assertCurrent(context)
        const file = await access.open(path, directory)
        try {
          assertCurrent(context)
          return file
        } catch (error) {
          await file.close()
          throw error
        }
      },
    }
  }
}
