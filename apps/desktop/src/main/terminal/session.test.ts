import type { TerminalCommandEvent } from '@sim/terminal-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  stripAnsi,
  stripTerminalQueries,
  TerminalSession,
  toInputChunks,
} from '@/main/terminal/session'

const ptyStub = vi.hoisted(() => ({
  dataHandler: null as ((data: string) => void) | null,
  exitHandler: null as (() => void) | null,
  writes: [] as string[],
  args: [] as string[],
  /** node-pty on Windows throws when `kill` is given a signal. */
  signalsSupported: true,
  ended: false,
}))

vi.mock('@lydell/node-pty', () => ({
  spawn: (_file: string, args: string[]) => {
    ptyStub.args = args
    return {
      pid: 1234,
      onData: (handler: (data: string) => void) => {
        ptyStub.dataHandler = handler
      },
      onExit: (handler: () => void) => {
        ptyStub.exitHandler = handler
      },
      write: (data: string) => ptyStub.writes.push(data),
      resize: vi.fn(),
      kill: (signal?: string) => {
        if (signal && !ptyStub.signalsSupported)
          throw new Error('Signals not supported on windows.')
        ptyStub.ended = true
      },
      pause: vi.fn(),
      resume: vi.fn(),
    }
  },
}))

vi.mock('@/main/terminal/shell-integration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/main/terminal/shell-integration')>()
  return { ...actual, createNonce: () => 'test-nonce' }
})

afterEach(() => {
  vi.useRealTimers()
  ptyStub.dataHandler = null
  ptyStub.exitHandler = null
  ptyStub.writes.length = 0
  ptyStub.signalsSupported = true
  ptyStub.ended = false
})

describe('toInputChunks', () => {
  it('separates Enter from the text so the text is actually submitted', () => {
    // A full-screen program reads one stdin chunk as one input event: "hi\r"
    // arriving together is read as text, lands in the composer, and never
    // submits. Enter has to be its own chunk.
    expect(toInputChunks('hi\n')).toEqual(['hi', '\r'])
  })

  it('collapses CRLF so one Enter is not sent twice', () => {
    expect(toInputChunks('hi\r\n')).toEqual(['hi', '\r'])
  })
})

describe('stripAnsi', () => {
  it('removes colour and cursor sequences so the model reads plain text', () => {
    expect(stripAnsi('\u001b[31mred\u001b[0m')).toBe('red')
    expect(stripAnsi('a\u001b[2Kb')).toBe('ab')
  })
})

describe('stripTerminalQueries', () => {
  // Replaying recorded bytes into a live emulator makes it answer every query
  // in the recording, and those answers are written to the pty as keystrokes.
  // With the asker long gone they pile up on the shell prompt as junk.
  it('removes device attribute queries and their replies', () => {
    expect(stripTerminalQueries('a\u001b[cb')).toBe('ab')
    expect(stripTerminalQueries('a\u001b[>cb')).toBe('ab')
    expect(stripTerminalQueries('a\u001b[?1;2cb')).toBe('ab')
    expect(stripTerminalQueries('a\u001b[>0;276;0cb')).toBe('ab')
  })
})

describe('TerminalSession command lifecycle', () => {
  it('keeps normal long-command activity until the foreground process exits', async () => {
    vi.useFakeTimers()
    const originalShell = process.env.SHELL
    process.env.SHELL = '/bin/zsh'
    const commandEvents: TerminalCommandEvent[] = []
    const session = TerminalSession.create({
      terminalId: 'terminal-1',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      callbacks: {
        onData: () => {},
        onState: () => {},
        onCommand: (event) => commandEvents.push(event),
        onExit: () => {},
      },
    })

    try {
      const resultPromise = session.runCommand('sleep 10', 'tool-call-long', 100)
      ptyStub.dataHandler?.('\u001b]633;C;test-nonce\u0007working\n')
      await vi.advanceTimersByTimeAsync(100)
      expect(await resultPromise).toMatchObject({ status: 'running' })
      expect(commandEvents.filter((event) => event.phase === 'end')).toEqual([])

      ptyStub.dataHandler?.('\u001b]633;D;0;test-nonce\u0007')
      expect(commandEvents.at(-1)).toMatchObject({
        terminalId: 'terminal-1',
        phase: 'end',
        command: 'sleep 10',
        toolCallId: 'tool-call-long',
        exitCode: 0,
      })
    } finally {
      session.dispose()
      if (originalShell === undefined) process.env.SHELL = undefined
      else process.env.SHELL = originalShell
    }
  })

  it('ends tool activity when an interactive command detaches, not when its process exits', async () => {
    vi.useFakeTimers()
    const originalShell = process.env.SHELL
    process.env.SHELL = '/bin/zsh'
    const commandEvents: TerminalCommandEvent[] = []
    const session = TerminalSession.create({
      terminalId: 'terminal-1',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      callbacks: {
        onData: () => {},
        onState: () => {},
        onCommand: (event) => commandEvents.push(event),
        onExit: () => {},
      },
    })

    try {
      const resultPromise = session.runCommand('vim', 'tool-call-1', 10_000)
      ptyStub.dataHandler?.('\u001b]633;C;test-nonce\u0007\u001b[?1049h')
      expect(await resultPromise).toMatchObject({ status: 'interactive' })
      // Detached from the tool call, the command is still the agent's until it exits.
      expect(session.runningToolCallId).toBeNull()
      expect(session.agentCommandToolCallId).toBe('tool-call-1')

      expect(commandEvents.at(-1)).toMatchObject({
        terminalId: 'terminal-1',
        phase: 'end',
        command: 'vim',
        toolCallId: 'tool-call-1',
      })

      ptyStub.dataHandler?.('\u001b]633;D;0;test-nonce\u0007')

      expect(commandEvents.at(-1)).toMatchObject({
        terminalId: 'terminal-1',
        phase: 'end',
        command: 'vim',
        exitCode: 0,
      })
      expect(session.agentCommandToolCallId).toBeNull()
      expect(commandEvents.at(-1)?.toolCallId).toBeUndefined()
    } finally {
      session.dispose()
      if (originalShell === undefined) process.env.SHELL = undefined
      else process.env.SHELL = originalShell
    }
  })

  describe('handing back a command that looks stuck on a prompt', () => {
    function promptSession(): TerminalSession {
      return TerminalSession.create({
        terminalId: 'terminal-prompt',
        cwd: '/tmp',
        cols: 80,
        rows: 24,
        callbacks: { onData: () => {}, onState: () => {}, onCommand: () => {}, onExit: () => {} },
      })
    }

    /** Whether `promise` has settled after `ms` of quiet. */
    async function settledAfter(promise: Promise<unknown>, ms: number): Promise<boolean> {
      let settled = false
      void promise.then(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(ms)
      return settled
    }

    it('keeps waiting on a silent command whose only output is escape codes', async () => {
      vi.useFakeTimers()
      const session = promptSession()
      try {
        const result = session.runCommand('sleep 60', 'tool-call-silent', 60_000)
        // ConPTY repaints the cursor and resets colour after the command line is echoed.
        ptyStub.dataHandler?.('\u001b]633;C;test-nonce\u0007\u001b[?25h\u001b[m')

        expect(await settledAfter(result, 5_000)).toBe(false)
        ptyStub.dataHandler?.('\u001b]633;D;0;test-nonce\u0007')
        await expect(result).resolves.toMatchObject({ status: 'completed' })
      } finally {
        session.dispose()
      }
    })

    it("never reads an interrupted command's ^C echo as a prompt", async () => {
      vi.useFakeTimers()
      const session = promptSession()
      try {
        const result = session.runCommand('stubborn', 'tool-call-stop', 60_000)
        ptyStub.dataHandler?.('\u001b]633;C;test-nonce\u0007working\r\n')
        session.kill('SIGINT')
        ptyStub.dataHandler?.('^C')

        expect(await settledAfter(result, 5_000)).toBe(false)
        ptyStub.dataHandler?.('\u001b]633;D;143;test-nonce\u0007')
        await expect(result).resolves.toMatchObject({ status: 'completed', exitCode: 143 })
      } finally {
        session.dispose()
      }
    })
  })

  it('stops pressing a batch of keys once the call is stopped', async () => {
    vi.useFakeTimers()
    const session = TerminalSession.create({
      terminalId: 'terminal-keys',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      callbacks: { onData: () => {}, onState: () => {}, onCommand: () => {}, onExit: () => {} },
    })
    try {
      const writesBefore = ptyStub.writes.length
      const stop = new AbortController()
      const pressing = session.pressKeys(['down', 'down', 'down', 'enter'], stop.signal)
      expect(ptyStub.writes.length - writesBefore).toBe(1)
      stop.abort()
      await vi.runAllTimersAsync()
      await pressing

      expect(ptyStub.writes.length - writesBefore).toBe(1)
    } finally {
      session.dispose()
    }
  })

  it('ends the wait between keystrokes on Stop while the program keeps redrawing', async () => {
    vi.useFakeTimers()
    const session = TerminalSession.create({
      terminalId: 'terminal-redraw',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      callbacks: { onData: () => {}, onState: () => {}, onCommand: () => {}, onExit: () => {} },
    })
    const redraw = setInterval(() => ptyStub.dataHandler?.('frame'), 20)
    try {
      const writesBefore = ptyStub.writes.length
      const stop = new AbortController()
      let settled = false
      const typing = session.type('first\nsecond', stop.signal).then(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(300)
      expect(settled).toBe(false)

      stop.abort()
      await vi.advanceTimersByTimeAsync(1)
      expect(settled).toBe(true)
      await typing

      expect(ptyStub.writes.slice(writesBefore)).toEqual(['first'])
    } finally {
      clearInterval(redraw)
      session.dispose()
    }
  })
})

describe('waiting for the prompt before typing a command', () => {
  const marker = (body: string) => `\u001b]633;${body};test-nonce\u0007`

  function promptSession(): TerminalSession {
    return TerminalSession.create({
      terminalId: 'terminal-prompt-drawn',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      callbacks: { onData: () => {}, onState: () => {}, onCommand: () => {}, onExit: () => {} },
    })
  }

  async function settledAfter(promise: Promise<unknown>, ms: number): Promise<boolean> {
    let settled = false
    void promise.then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(ms)
    return settled
  }

  it('waits, in a shell that reports it, until the next prompt is drawn', async () => {
    vi.useFakeTimers()
    const session = promptSession()
    try {
      ptyStub.dataHandler?.(`${marker('A')}$ ${marker('B')}`)
      // The last command just finished: its prompt is not drawn yet.
      ptyStub.dataHandler?.(`${marker('D;0')}${marker('A')}`)
      const drawn = session.waitForPromptDrawn()

      expect(await settledAfter(drawn, 500)).toBe(false)
      ptyStub.dataHandler?.(`$ ${marker('B')}`)
      expect(await settledAfter(drawn, 0)).toBe(true)
    } finally {
      session.dispose()
    }
  })

  it('never waits on a shell that does not report its prompt', async () => {
    vi.useFakeTimers()
    const session = promptSession()
    try {
      ptyStub.dataHandler?.(`${marker('D;0')}${marker('A')}`)
      expect(await settledAfter(session.waitForPromptDrawn(), 0)).toBe(true)
    } finally {
      session.dispose()
    }
  })

  it('types anyway once a prompt that reports itself is slow to come', async () => {
    vi.useFakeTimers()
    const session = promptSession()
    try {
      ptyStub.dataHandler?.(`${marker('A')}$ ${marker('B')}${marker('A')}`)
      expect(await settledAfter(session.waitForPromptDrawn(), 2_100)).toBe(true)
    } finally {
      session.dispose()
    }
  })
})

describe('TerminalSession on Windows', () => {
  const marker = (body: string) => `\u001b]633;${body};test-nonce\u0007`

  function sessionOn(
    platform: NodeJS.Platform,
    onData: (terminalId: string, data: string) => void = () => {}
  ): TerminalSession {
    return TerminalSession.create({
      terminalId: 'terminal-windows',
      cwd: 'C:\\Users\\me',
      cols: 80,
      rows: 24,
      platform,
      callbacks: { onData, onState: () => {}, onCommand: () => {}, onExit: () => {} },
    })
  }

  const DEVICE_ATTRIBUTES_REPLY = '\u001b[?1;2c'

  it("answers ConPTY's startup query once, which otherwise holds the shell back for 3 s", async () => {
    vi.useFakeTimers()
    let painted = ''
    const session = sessionOn('win32', (_id, data) => {
      painted += data
    })
    try {
      ptyStub.dataHandler?.('\u001b[1t')
      ptyStub.dataHandler?.('\u001b[c\u001b[?1004h')
      // A program's own query later on is the panel's to answer.
      ptyStub.dataHandler?.('\u001b[c')
      await vi.advanceTimersByTimeAsync(50)

      expect(ptyStub.writes.filter((write) => write === DEVICE_ATTRIBUTES_REPLY)).toHaveLength(1)
      expect(painted).toBe('\u001b[1t\u001b[?1004h\u001b[c')
    } finally {
      session.dispose()
    }
  })

  it.each([
    [['\u001b[1t\u001b', '[c\u001b[?1004h']],
    [['\u001b[1t\u001b[', 'c\u001b[?1004h']],
    [['\u001b[1t\u001b', '[', 'c\u001b[?1004h']],
  ])('answers the startup query when ConPTY splits it across chunks: %j', async (chunks) => {
    vi.useFakeTimers()
    let painted = ''
    const session = sessionOn('win32', (_id, data) => {
      painted += data
    })
    try {
      for (const chunk of chunks) ptyStub.dataHandler?.(chunk)
      await vi.advanceTimersByTimeAsync(50)

      expect(ptyStub.writes.filter((write) => write === DEVICE_ATTRIBUTES_REPLY)).toHaveLength(1)
      expect(painted).toBe('\u001b[1t\u001b[?1004h')
    } finally {
      session.dispose()
    }
  })

  it('releases a held escape the next chunk shows was not the query', async () => {
    vi.useFakeTimers()
    let painted = ''
    const session = sessionOn('win32', (_id, data) => {
      painted += data
    })
    try {
      ptyStub.dataHandler?.('\u001b[1t\u001b[')
      ptyStub.dataHandler?.('?1004h')
      await vi.advanceTimersByTimeAsync(50)

      expect(painted).toBe('\u001b[1t\u001b[?1004h')
      expect(ptyStub.writes).not.toContain(DEVICE_ATTRIBUTES_REPLY)
    } finally {
      session.dispose()
    }
  })

  it('leaves the startup query of a macOS shell to the panel', async () => {
    vi.useFakeTimers()
    const session = sessionOn('darwin')
    try {
      ptyStub.dataHandler?.('\u001b[c')
      await vi.advanceTimersByTimeAsync(50)

      expect(ptyStub.writes).not.toContain(DEVICE_ATTRIBUTES_REPLY)
    } finally {
      session.dispose()
    }
  })

  it('starts the shell without the POSIX login flag, which Windows shells reject', () => {
    const session = sessionOn('win32')
    try {
      expect(ptyStub.args).not.toContain('-l')
    } finally {
      session.dispose()
    }
  })

  it('ends the shell for a terminating signal, which node-pty refuses to send there', () => {
    ptyStub.signalsSupported = false
    const session = sessionOn('win32')
    try {
      session.kill('SIGTERM')
      expect(ptyStub.ended).toBe(true)
    } finally {
      session.dispose()
    }
  })

  it('names the tab after the last folder of a Windows path', () => {
    const session = sessionOn('win32')
    try {
      ptyStub.dataHandler?.(marker('P;Cwd=D:\\\\work\\\\project'))
      expect(session.tabState(true).title).toBe('project')
    } finally {
      session.dispose()
    }
  })
})
