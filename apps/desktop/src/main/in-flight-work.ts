import { createLogger } from '@sim/logger'
import { describeRunningCommand } from '@sim/terminal-protocol'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import type { WebContents } from 'electron'

const logger = createLogger('DesktopInFlightWork')

/** A renderer that cannot answer this quickly is treated as hung, holding edits it cannot report. */
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

type UnloadAnswer = 'clean' | 'unsaved' | 'unresponsive'

async function askAboutUnsavedChanges(contents: WebContents): Promise<UnloadAnswer> {
  if (contents.isDestroyed() || contents.isCrashed()) return 'clean'
  try {
    const answer = await Promise.race([
      contents.executeJavaScript(UNSAVED_CHANGES_PROBE),
      sleep(UNSAVED_CHANGES_PROBE_TIMEOUT_MS).then(() => 'unresponsive' as const),
    ])
    if (answer === 'unresponsive') return answer
    return answer === true ? 'unsaved' : 'clean'
  } catch (error) {
    logger.warn('Could not ask a window about unsaved changes', {
      message: getErrorMessage(error, 'unknown'),
    })
    return 'unresponsive'
  }
}

/**
 * Counts the windows whose pages would ask before leaving, and those too hung
 * to answer, which may be holding edits just the same.
 */
export async function countWindowsWithUnsavedChanges(
  windows: readonly WebContents[]
): Promise<Pick<InFlightWork, 'unsavedWindowCount' | 'unresponsiveWindowCount'>> {
  const answers = await Promise.all(windows.map(askAboutUnsavedChanges))
  return {
    unsavedWindowCount: answers.filter((answer) => answer === 'unsaved').length,
    unresponsiveWindowCount: answers.filter((answer) => answer === 'unresponsive').length,
  }
}

export interface InFlightWork {
  /** The command line holding each busy terminal's foreground (`''` when unannounced). */
  terminalCommands: readonly string[]
  /** Terminals whose foreground could not be read, which may be running a command. */
  uncheckedTerminalCount: number
  /** The app a computer-use action is driving, `''` when it has no name, or null when idle. */
  computerUseApp: string | null
  /** Whether an agent has a browser action queued or running. */
  browserToolRunning: boolean
  /** Whether a chat has desktop work claimed on this machine. */
  agentWorkRunning: boolean
  /** Agent-browser and app-window downloads still in progress. */
  downloadCount: number
  unsavedWindowCount: number
  unresponsiveWindowCount: number
}

/**
 * One sentence for the busy terminals. Commands are named while at most two are running and
 * at most one is unannounced; past that, two "a command"s would say nothing, so they are counted.
 */
function describeTerminalCommands(commands: readonly string[]): string | null {
  if (commands.length === 0) return null
  const named = commands.filter((command) => command.trim()).map(describeRunningCommand)
  const unnamed = commands.length - named.length
  if (unnamed > 1 || commands.length > MAX_NAMED_TERMINAL_COMMANDS) {
    return `${commands.length} terminal commands are still running.`
  }
  const labels = unnamed === 1 ? [...named, describeRunningCommand('')] : named
  const sentence =
    labels.length > 1
      ? `${labels.join(' and ')} are still running in terminals.`
      : `${labels[0]} is still running in a terminal.`
  // Program names keep their own case; only the generic "a command" label is capitalized.
  return named.length === 0 ? sentence.charAt(0).toUpperCase() + sentence.slice(1) : sentence
}

/**
 * Names the work a restart would interrupt, one sentence per kind, so a
 * restart prompt says exactly what is at stake. Empty when nothing is.
 */
export function describeInFlightWork(work: InFlightWork): string[] {
  const sentences: string[] = []
  const terminalSentence = describeTerminalCommands(work.terminalCommands)
  if (terminalSentence) sentences.push(terminalSentence)
  if (work.uncheckedTerminalCount === 1) {
    sentences.push("A terminal couldn't be checked and may still be running a command.")
  } else if (work.uncheckedTerminalCount > 1) {
    sentences.push(
      `${work.uncheckedTerminalCount} terminals couldn't be checked and may still be running commands.`
    )
  }

  if (work.computerUseApp !== null) {
    sentences.push(
      work.computerUseApp
        ? `An agent is using ${work.computerUseApp}.`
        : 'An agent is using an app on this computer.'
    )
  }
  if (work.browserToolRunning) {
    sentences.push('An agent is using the browser.')
  }
  if (work.agentWorkRunning && work.computerUseApp === null && !work.browserToolRunning) {
    sentences.push('An agent is still working on this computer.')
  }

  if (work.downloadCount === 1) {
    sentences.push('A download is still in progress.')
  } else if (work.downloadCount > 1) {
    sentences.push(`${work.downloadCount} downloads are still in progress.`)
  }

  if (work.unsavedWindowCount === 1) {
    sentences.push('A window has unsaved changes.')
  } else if (work.unsavedWindowCount > 1) {
    sentences.push(`${work.unsavedWindowCount} windows have unsaved changes.`)
  }
  if (work.unresponsiveWindowCount === 1) {
    sentences.push("A window isn't responding and may have unsaved changes.")
  } else if (work.unresponsiveWindowCount > 1) {
    sentences.push(
      `${work.unresponsiveWindowCount} windows aren't responding and may have unsaved changes.`
    )
  }
  return sentences
}
