/**
 * Runs one claimed call on this machine, in the scope of the chat Sim says it belongs to: that
 * chat's built-in browser tabs, its terminals, or the user's granted folders. Arguments always
 * come from Sim's record of the call. Every outcome, including a refusal, is a completion built
 * by the same projections the chat view uses, so the model sees one shape either way.
 */
import {
  type BrowserToolName,
  browserToolRendererTimeoutMs,
  isCurrentBrowserToolName,
} from '@sim/browser-protocol'
import type {
  DesktopLocalFileRequest,
  DesktopLocalFileResponse,
  LocalFilesystemRequest,
  LocalFilesystemResponse,
} from '@sim/desktop-bridge'
import { runUserLocalFilesystemTool } from '@sim/desktop-bridge/local-filesystem-tools'
import {
  assertImportableManifest,
  browserSessionClosedCompletion,
  browserToolCompletion,
  browserToolFailure,
  browserToolNeedsLivePage,
  browserToolTimeoutMessage,
  type DesktopLocalFileImportResult,
  type DesktopToolCompletion,
  localFileImportCompletion,
  localFileImportFailure,
  localFileReadCompletion,
  localFilesystemToolCompletion,
  readImportEntry,
  terminalOperationTimeoutMs,
  terminalToolCompletion,
  terminalToolFailure,
} from '@sim/desktop-bridge/tool-results'
import { createLogger } from '@sim/logger'
import {
  isTerminalOperation,
  type TerminalOperation,
  type TerminalToolArgs,
  type TerminalToolResponse,
} from '@sim/terminal-protocol'
import { getErrorMessage } from '@sim/utils/errors'
import { interruptibleSleep } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
import { backoffWithJitter } from '@sim/utils/retry'
import { DeviceRequestError } from '@/main/desktop-executor/client'
import type { DesktopToolRunner } from '@/main/desktop-executor/executor'
import type {
  ClaimedDesktopCall,
  DesktopImportEntryRequest,
  DesktopImportedEntry,
} from '@/main/desktop-executor/protocol'

const logger = createLogger('DesktopExecutorRunner')

const USER_LOCAL_TOOLS: ReadonlySet<string> = new Set(['read', 'grep', 'glob'])
/** A rate-limited import entry is retried this many times; Sim never stored a refused one. */
const IMPORT_RATE_LIMIT_ATTEMPTS = 8
const IMPORT_RATE_LIMIT_MAX_WAIT_MS = 30_000

/** The model learns a call never ran because a surface is switched off on this machine. */
function surfaceOff(surface: string): DesktopToolCompletion {
  const message = `Not run: this action never started, because ${surface} is switched off in the Sim desktop app’s settings. Nothing happened on the user’s computer. Do not retry it in this turn; continue without it, or ask the user to switch it on.`
  return { status: 'error', message, data: { error: message, notStarted: true } }
}

/** Local files are out of reach while the app has no usable account storage, a passing state. */
function localAccessUnavailable(): DesktopToolCompletion {
  const message =
    'Not run: this action never started, because the Sim desktop app cannot reach local files right now (it is signing out, switching account, or its storage is unavailable). Nothing happened on the user’s computer. Do not retry it in this turn; tell the user, who can ask again once the app is ready.'
  return { status: 'error', message, data: { error: message, notStarted: true } }
}

function unsupported(toolName: string): DesktopToolCompletion {
  const message = `Not run: this action never started, because this version of the Sim desktop app cannot run ${toolName} in the background. Nothing happened on the user’s computer. Do not retry it in this turn; tell the user to update the Sim desktop app.`
  return { status: 'error', message, data: { error: message, notStarted: true } }
}

export interface DesktopToolRunnerDeps {
  preferences: () => { browserEnabled: boolean; terminalEnabled: boolean }
  /** False while account-bearing local storage is unavailable; local tools then refuse. */
  accountDataAvailable: () => boolean
  browser: {
    executeTool(
      scopeId: string,
      tool: BrowserToolName,
      params: Record<string, unknown>,
      toolCallId: string
    ): Promise<{ ok: boolean; result?: unknown; error?: string }>
    cancelTool(scopeId: string, toolCallId: string): boolean
    hasSession(scopeId: string): boolean
    restoreScope(scopeId: string): void
  }
  terminal: {
    executeTool(
      scope: string,
      toolCallId: string,
      operation: TerminalOperation,
      args: TerminalToolArgs
    ): Promise<TerminalToolResponse>
    cancelTool(scope: string, toolCallId: string): Promise<boolean>
  }
  /** Reads a `read_local_file` or `import_local_files` source, authorized by the call itself. */
  localFiles: {
    request(
      call: ClaimedDesktopCall,
      request: DesktopLocalFileRequest,
      signal: AbortSignal
    ): Promise<DesktopLocalFileResponse>
  }
  imports: {
    importEntry(
      request: DesktopImportEntryRequest,
      signal: AbortSignal
    ): Promise<DesktopImportedEntry>
  }
  localFilesystem: {
    handle(request: LocalFilesystemRequest): Promise<LocalFilesystemResponse>
    vfsRoot(mount: { id: string; name: string }): string
  }
}

/** A terminal operation that outlived its deadline may still land, as a browser action may. */
function terminalTimedOut(timeoutMs: number): DesktopToolCompletion {
  const message = `The terminal did not respond within ${timeoutMs}ms. The operation may still be running and take effect: do not retry it automatically; check the terminal's state first.`
  return {
    status: 'error',
    message,
    data: { error: message, outcomeUnknown: true, doNotRetry: true },
  }
}

/** Resolves once the signal aborts, which may be never. */
function untilAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
}

/** Resolves with the work's result, or with `onTimeout`'s once `timeoutMs` passes first. */
async function withDeadline<T>(
  work: Promise<T>,
  timeoutMs: number | null,
  onTimeout: () => T
): Promise<T> {
  if (timeoutMs === null) return work
  // Aborted once the race settles, which cancels the sleep; a cancelled sleep never times out.
  const settled = new AbortController()
  const timeout = interruptibleSleep(timeoutMs, settled.signal).then(() =>
    settled.signal.aborted ? new Promise<T>(() => {}) : onTimeout()
  )
  try {
    return await Promise.race([work, timeout])
  } finally {
    settled.abort()
  }
}

export function createDesktopToolRunner(deps: DesktopToolRunnerDeps): DesktopToolRunner {
  /** Each chat's last terminal operation, until it actually settles. */
  const unsettledTerminalWork = new Map<string, Promise<void>>()

  async function runBrowser(
    call: ClaimedDesktopCall,
    tool: BrowserToolName
  ): Promise<DesktopToolCompletion> {
    if (!deps.preferences().browserEnabled) return surfaceOff('the built-in browser')
    if (browserToolNeedsLivePage(tool) && !deps.browser.hasSession(call.chatId)) {
      try {
        deps.browser.restoreScope(call.chatId)
      } catch (error) {
        logger.warn('Could not restore a chat browser before a background call', {
          toolCallId: call.toolCallId,
          error: getErrorMessage(error),
        })
      }
      if (!deps.browser.hasSession(call.chatId)) return browserSessionClosedCompletion()
    }
    const timeoutMs =
      tool === 'browser_request_takeover' ? null : browserToolRendererTimeoutMs(tool, call.args)
    return withDeadline(
      deps.browser.executeTool(call.chatId, tool, call.args, call.toolCallId).then((response) =>
        response.ok
          ? browserToolCompletion(tool, response.result)
          : browserToolFailure(response.error ?? 'The browser action failed.', {
              sessionClosed: !deps.browser.hasSession(call.chatId),
            })
      ),
      timeoutMs,
      () => {
        deps.browser.cancelTool(call.chatId, call.toolCallId)
        return browserToolFailure(browserToolTimeoutMessage(timeoutMs ?? 0), {
          outcomeUnknown: true,
        })
      }
    )
  }

  async function runTerminal(
    call: ClaimedDesktopCall,
    signal: AbortSignal
  ): Promise<DesktopToolCompletion> {
    if (!deps.preferences().terminalEnabled) return surfaceOff('the terminal')
    const { operation } = call.args
    if (!isTerminalOperation(operation)) {
      return terminalToolFailure(
        `Unknown terminal operation: ${String(operation)}`,
        'INVALID_REQUEST'
      )
    }
    const args = isRecordLike(call.args.args) ? (call.args.args as TerminalToolArgs) : {}
    const timeoutMs = terminalOperationTimeoutMs(operation)
    // An operation reported as unresponsive may still land; the chat's next one waits for it, so
    // two never act on the same terminals at once.
    const previous = unsettledTerminalWork.get(call.chatId)
    if (previous) await Promise.race([previous, untilAborted(signal)])
    // Stopped while it waited: the terminal never heard of it, so its own cancel cannot reach it.
    if (signal.aborted) {
      return terminalToolFailure('The terminal action was stopped before it started.', 'CANCELLED')
    }
    const operationDone = deps.terminal.executeTool(call.chatId, call.toolCallId, operation, args)
    const settled = operationDone.then(
      () => undefined,
      () => undefined
    )
    unsettledTerminalWork.set(call.chatId, settled)
    void settled.then(() => {
      if (unsettledTerminalWork.get(call.chatId) === settled)
        unsettledTerminalWork.delete(call.chatId)
    })
    return withDeadline(operationDone.then(terminalToolCompletion), timeoutMs, () =>
      terminalTimedOut(timeoutMs ?? 0)
    )
  }

  async function runUserLocal(
    call: ClaimedDesktopCall,
    signal: AbortSignal
  ): Promise<DesktopToolCompletion> {
    try {
      const data = await runUserLocalFilesystemTool(call.toolCallId, call.toolName, call.args, {
        invoke: (request) => deps.localFilesystem.handle(request),
        vfsRoot: deps.localFilesystem.vfsRoot,
        signal,
      })
      return localFilesystemToolCompletion({ ok: true, data })
    } catch (error) {
      return localFilesystemToolCompletion({ ok: false, error: getErrorMessage(error) })
    }
  }

  /**
   * Imports the call's source into its workspace one entry at a time: each directory as a folder,
   * each file read in chunks and checked against the manifest that listed it.
   */
  /**
   * Sends one entry, waiting out Sim's rate limit: a large tree can outrun it, and a 429 means
   * nothing was stored, so sending the entry again cannot duplicate it.
   */
  async function importEntry(
    request: DesktopImportEntryRequest,
    signal: AbortSignal
  ): Promise<DesktopImportedEntry> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await deps.imports.importEntry(request, signal)
      } catch (error) {
        if (
          !(error instanceof DeviceRequestError) ||
          error.status !== 429 ||
          attempt >= IMPORT_RATE_LIMIT_ATTEMPTS
        ) {
          throw error
        }
        await interruptibleSleep(
          backoffWithJitter(attempt, error.retryAfterMs, { maxMs: IMPORT_RATE_LIMIT_MAX_WAIT_MS }),
          signal
        )
        signal.throwIfAborted()
      }
    }
  }

  async function runImport(
    call: ClaimedDesktopCall,
    signal: AbortSignal
  ): Promise<DesktopToolCompletion> {
    const files: DesktopLocalFileImportResult['files'] = []
    const folders: DesktopLocalFileImportResult['folders'] = []
    const targetWorkspaceId =
      typeof call.args.targetWorkspaceId === 'string' ? call.args.targetWorkspaceId : ''
    const read = (request: DesktopLocalFileRequest) =>
      deps.localFiles.request(call, request, signal)
    try {
      const response = await read({ operation: 'manifest', toolCallId: call.toolCallId })
      if (!response.ok) throw new Error(response.error)
      if (response.data.kind !== 'manifest') throw new Error('Unexpected file manifest response.')
      const manifest = response.data
      assertImportableManifest(manifest)
      for (const entry of manifest.entries) {
        signal.throwIfAborted()
        const target = { call, sourceName: manifest.name, relativePath: entry.relativePath }
        if (entry.kind === 'directory') {
          const folder = await importEntry({ ...target, kind: 'directory' }, signal)
          folders.push({ id: folder.id, relativePath: entry.relativePath })
          continue
        }
        const parts = await readImportEntry(call.toolCallId, entry, read, signal)
        const file = await importEntry(
          { ...target, kind: 'file', content: new Blob(parts) },
          signal
        )
        files.push({ id: file.id, name: file.name, relativePath: entry.relativePath })
      }
      return localFileImportCompletion({
        success: true,
        workspaceId: manifest.targetWorkspaceId,
        files,
        folders,
      })
    } catch (error) {
      return localFileImportCompletion(
        localFileImportFailure(
          { workspaceId: targetWorkspaceId, files, folders },
          getErrorMessage(error),
          // A rate limit that outlasted every retry refused the entry outright: nothing of it landed.
          { outcomeKnown: error instanceof DeviceRequestError && error.status === 429 }
        )
      )
    }
  }

  return {
    async run(call, signal) {
      try {
        if (isCurrentBrowserToolName(call.toolName)) return await runBrowser(call, call.toolName)
        if (call.toolName === 'terminal') return await runTerminal(call, signal)
        if (!deps.accountDataAvailable()) return localAccessUnavailable()
        if (call.toolName === 'read_local_file') {
          return localFileReadCompletion(
            await deps.localFiles.request(
              call,
              {
                operation: 'read',
                toolCallId: call.toolCallId,
              },
              signal
            )
          )
        }
        if (call.toolName === 'import_local_files') return await runImport(call, signal)
        if (USER_LOCAL_TOOLS.has(call.toolName)) return await runUserLocal(call, signal)
        return unsupported(call.toolName)
      } catch (error) {
        logger.error('Background desktop call failed unexpectedly', {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          error: getErrorMessage(error),
        })
        const message = `The Sim desktop app could not finish this action: ${getErrorMessage(error)}`
        return {
          status: 'error',
          message,
          data: { error: message, outcomeUnknown: true, doNotRetry: true },
        }
      }
    },
    async cancel(call) {
      if (isCurrentBrowserToolName(call.toolName)) {
        deps.browser.cancelTool(call.chatId, call.toolCallId)
        return
      }
      if (call.toolName === 'terminal') {
        await deps.terminal.cancelTool(call.chatId, call.toolCallId)
        return
      }
      if (USER_LOCAL_TOOLS.has(call.toolName)) {
        await deps.localFilesystem.handle({ operation: 'cancel', requestId: call.toolCallId })
      }
    },
  }
}
