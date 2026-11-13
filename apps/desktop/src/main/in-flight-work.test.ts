import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  countWindowsWithUnsavedChanges,
  describeInFlightWork,
  type InFlightWork,
} from '@/main/in-flight-work'

vi.mock('electron', () => import('@/test/electron-mock'))

function windowAnswering(answer: () => Promise<unknown>, state = { destroyed: false }) {
  return {
    isDestroyed: () => state.destroyed,
    isCrashed: () => false,
    executeJavaScript: vi.fn(answer),
  } as unknown as WebContents
}

describe('countWindowsWithUnsavedChanges', () => {
  it('never reports a window it could not ask as clean', async () => {
    const counts = await countWindowsWithUnsavedChanges([
      windowAnswering(() => Promise.resolve(true)),
      windowAnswering(() => Promise.resolve(false)),
      windowAnswering(() => Promise.reject(new Error('Script failed to execute'))),
      windowAnswering(() => Promise.resolve(true), { destroyed: true }),
    ])

    expect(counts).toEqual({ unsavedWindowCount: 1, unresponsiveWindowCount: 1 })
  })
})

describe('describeInFlightWork', () => {
  const zsh = (command: string) => ({ command, shell: 'zsh' })
  const IDLE: InFlightWork = {
    terminalCommands: [],
    uncheckedTerminalCount: 0,
    computerUseApp: null,
    browserToolRunning: false,
    agentWorkRunning: false,
    downloadCount: 0,
    unsavedWindowCount: 0,
    unresponsiveWindowCount: 0,
  }

  it('warns about a terminal it could not check rather than restarting silently', () => {
    expect(describeInFlightWork({ ...IDLE, uncheckedTerminalCount: 2 })).toEqual([
      "2 terminals couldn't be checked and may still be running commands.",
    ])
    expect(describeInFlightWork({ ...IDLE, uncheckedTerminalCount: 1 })).toEqual([
      "A terminal couldn't be checked and may still be running a command.",
    ])
  })

  it('starts the sentence for an unannounced command with a capital', () => {
    expect(describeInFlightWork({ ...IDLE, terminalCommands: [zsh('')] })).toEqual([
      'A command is still running in a terminal.',
    ])
    expect(describeInFlightWork({ ...IDLE, terminalCommands: [zsh('npm run dev')] })).toEqual([
      'npm is still running in a terminal.',
    ])
  })

  it('counts unannounced commands rather than naming "a command" twice', () => {
    expect(describeInFlightWork({ ...IDLE, terminalCommands: [zsh(''), zsh('')] })).toEqual([
      '2 terminal commands are still running.',
    ])
    expect(
      describeInFlightWork({ ...IDLE, terminalCommands: [zsh(''), zsh('npm run dev')] })
    ).toEqual(['npm and a command are still running in terminals.'])
    expect(
      describeInFlightWork({
        ...IDLE,
        terminalCommands: [zsh(''), zsh('npm run dev'), zsh('claude')],
      })
    ).toEqual(['3 terminal commands are still running.'])
  })

  it("names a Windows command by its program, read in its own shell's syntax", () => {
    expect(
      describeInFlightWork({
        ...IDLE,
        terminalCommands: [{ command: 'C:\\tools\\node.exe server.js', shell: 'pwsh' }],
      })
    ).toEqual(['node is still running in a terminal.'])
  })
})
