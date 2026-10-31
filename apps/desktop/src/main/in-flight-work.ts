import { createLogger } from '@sim/logger'
import { describeRunningCommand } from '@sim/terminal-protocol'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import type { WebContents } from 'electron'

const logger = createLogger('DesktopInFlightWork')

/** A renderer that cannot answer this quickly is hung, and its edits are not recoverable anyway. */
const UNSAVED_CHANGES_PROBE_TIMEOUT_MS = 1_000
const MAX_NAMED_TERMINAL_COMMANDS = 2

/**
 * Asks the page's own `beforeunload` guards whether they would hold it open, without unloading it,
 * so every editor's live dirty state counts and no renderer needs to know about the shell.
 */
const UNSAVED_CHANGES_PROBE = `(() => {
  let event
  try {
    event = document.createEvent('BeforeUnloadEvent')
    event.initEvent('beforeunload', false, true)
  } catch {
    event = new Event('beforeunload', { cancelable: true })
  }
  window.dispatchEvent(event)
  return event.defaultPrevented || (typeof event.returnValue === 'string' && event.returnValue !== '')
})()`

async function hasUnsavedChanges(contents: WebContents): Promise<boolean> {
  if (contents.isDestroyed() || contents.isCrashed()) return false
  try {
    const answer = await Promise.race([
      contents.executeJavaScript(UNSAVED_CHANGES_PROBE),
      sleep(UNSAVED_CHANGES_PROBE_TIMEOUT_MS).then(() => false),
    ])
    return answer === true
  } catch (error) {
    logger.warn('Could not ask a window about unsaved changes', {
      message: getErrorMessage(error, 'unknown'),
    })
    return false
  }
}

/** How many of these windows' pages would ask before leaving; a page that cannot answer does not. */
export async function countWindowsWithUnsavedChanges(
  windows: readonly WebContents[]
): Promise<number> {
  return (await Promise.all(windows.map(hasUnsavedChanges))).filter(Boolean).length
}

export interface InFlightWork {
  /** The command line holding each busy terminal's foreground (`''` when unannounced). */
  terminalCommands: readonly string[]
  /** The app a computer-use action is driving, `''` when it has no name, or null when idle. */
  computerUseApp: string | null
  /** Whether a chat has desktop work claimed on this machine. */
  agentWorkRunning: boolean
  unsavedWindowCount: number
}

/**
 * Names the work a restart would interrupt, one sentence per kind, so a
 * restart prompt says exactly what is at stake. Empty when nothing is.
 */
export function describeInFlightWork(work: InFlightWork): string[] {
  const sentences: string[] = []
  const commands = work.terminalCommands.map(describeRunningCommand)
  if (commands.length > MAX_NAMED_TERMINAL_COMMANDS) {
    sentences.push(`${commands.length} terminal commands are still running.`)
  } else if (commands.length > 1) {
    sentences.push(`${commands.join(' and ')} are still running in terminals.`)
  } else if (commands.length === 1) {
    sentences.push(`${commands[0]} is still running in a terminal.`)
  }

  if (work.computerUseApp !== null) {
    sentences.push(
      work.computerUseApp
        ? `An agent is using ${work.computerUseApp}.`
        : 'An agent is using an app on this computer.'
    )
  } else if (work.agentWorkRunning) {
    sentences.push('An agent is still working on this computer.')
  }

  if (work.unsavedWindowCount === 1) {
    sentences.push('A window has unsaved changes.')
  } else if (work.unsavedWindowCount > 1) {
    sentences.push(`${work.unsavedWindowCount} windows have unsaved changes.`)
  }
  return sentences
}
