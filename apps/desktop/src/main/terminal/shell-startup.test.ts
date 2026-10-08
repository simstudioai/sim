import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalService } from '@/main/terminal'

/**
 * A new shell's first prompt, as the service waits for it before running the agent's command.
 * node-pty is stubbed so each test plays the shell's side: the startup marker our generated files
 * send before the user's run, whatever the user's files print, and the first prompt. The service
 * and the session are real.
 */
const pty = vi.hoisted(() => ({
  emit: null as ((data: string) => void) | null,
  exit: null as (() => void) | null,
  writes: [] as string[],
}))

vi.mock('@lydell/node-pty', () => ({
  spawn: () => ({
    pid: 4321,
    onData: (handler: (data: string) => void) => {
      pty.emit = handler
    },
    onExit: (handler: () => void) => {
      pty.exit = handler
    },
    write: (data: string) => pty.writes.push(data),
    resize: vi.fn(),
    kill: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  }),
}))

vi.mock('@/main/terminal/shell-integration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/main/terminal/shell-integration')>()
  return { ...actual, createNonce: () => 'nonce' }
})

vi.mock('@/main/terminal/tmux', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/main/terminal/tmux')>()
  return { ...actual, isTmuxUnavailable: () => true }
})

const marker = (body: string) => `\u001b]633;${body};nonce\u0007`
const STARTUP = marker('SimStartup')
const PROMPT = marker('A')

function shell(data: string): void {
  pty.emit?.(data)
}

/** Plays a command the shell was asked to run through to its prompt, once it was typed. */
async function answerCommand(output: string): Promise<void> {
  await vi.waitFor(() => expect(pty.writes.some((write) => write.endsWith('\r'))).toBe(true))
  shell(`${marker('C')}${output}\r\n${marker('D;0')}${PROMPT}`)
}

/** Lets timers run until `promise` settles: the screen is read through an emulator that parses on them. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  let done = false
  void promise.finally(() => {
    done = true
  })
  for (let step = 0; step < 1_000 && !done; step++) await vi.advanceTimersByTimeAsync(10)
  return promise
}

beforeEach(() => {
  vi.stubEnv('SHELL', '/bin/zsh')
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  })
})

afterEach(() => {
  vi.useRealTimers()
  pty.emit = null
  pty.exit = null
  pty.writes.length = 0
  vi.unstubAllEnvs()
})

describe('a shell that is still starting', () => {
  it('runs the command once slow startup files reach a prompt', async () => {
    // A heavy .zshrc on a busy machine: our files began at once, the user's took 20 s.
    const terminal = new TerminalService({ loadCwd: () => '/tmp' })
    const running = terminal.executeTool('call-slow', 'run', {
      command: 'echo hi',
      waitSeconds: 30,
    })
    shell(STARTUP)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(pty.writes).toEqual([])

    shell(PROMPT)
    await answerCommand('hi')
    const response = await running

    expect(response).toMatchObject({ ok: true, result: { exitCode: 0 } })
    terminal.dispose()
  })

  it('gives startup files their full bound from when they began, however late that was', async () => {
    // A machine so busy our files began 7 s after spawn, and the user's then took 25 s more.
    const terminal = new TerminalService({ loadCwd: () => '/tmp' })
    const running = terminal.executeTool('call-late', 'run', { command: 'echo hi' })
    await vi.advanceTimersByTimeAsync(7_000)
    shell(STARTUP)
    await vi.advanceTimersByTimeAsync(25_000)
    expect(pty.writes).toEqual([])

    shell(PROMPT)
    await answerCommand('hi')
    const response = await running

    expect(response).toMatchObject({ ok: true, result: { exitCode: 0 } })
    terminal.dispose()
  })

  it('refuses with the screen when startup files stall on a question', async () => {
    const terminal = new TerminalService({ loadCwd: () => '/tmp' })
    const running = terminal.executeTool('call-stalled', 'run', { command: 'echo hi' })
    shell(`${STARTUP}[oh-my-zsh] Would you like to update? [Y/n] `)
    await vi.advanceTimersByTimeAsync(30_000)
    const response = await settle(running)

    expect(response).toMatchObject({ ok: false, code: 'NO_SHELL_INTEGRATION' })
    expect(response.error).toContain('[oh-my-zsh] Would you like to update? [Y/n]')
    expect(response.error).toContain('ask the user to answer it')
    expect(response.error).toContain('a startup file replaced the shell')
    expect(pty.writes).toEqual([])
    terminal.dispose()
  })

  it('reports the session closed when the shell exits while its startup files run', async () => {
    const terminal = new TerminalService({ loadCwd: () => '/tmp' })
    const running = terminal.executeTool('call-exit', 'run', { command: 'echo hi' })
    shell(STARTUP)
    await vi.advanceTimersByTimeAsync(2_000)
    pty.exit?.()
    const response = await running

    expect(response).toMatchObject({ ok: false, code: 'SESSION_CLOSED' })
    expect(pty.writes).toEqual([])
    terminal.dispose()
  })

  it('refuses a shell that never began our startup files at the short bound', async () => {
    const terminal = new TerminalService({ loadCwd: () => '/tmp' })
    const running = terminal.executeTool('call-plain', 'run', { command: 'echo hi' })
    await vi.advanceTimersByTimeAsync(8_000)
    const response = await running

    expect(response).toMatchObject({ ok: false, code: 'NO_SHELL_INTEGRATION' })
    expect(response.error).toContain('did not load Sim shell integration')
    terminal.dispose()
  })

  it('ends the wait as soon as the call is stopped, without running anything', async () => {
    const terminal = new TerminalService({ loadCwd: () => '/tmp' })
    const running = terminal.executeTool('call-stop', 'run', { command: 'echo hi' })
    shell(STARTUP)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(await terminal.cancelTool('call-stop')).toBe(true)
    const response = await running

    expect(response).toMatchObject({ ok: false, code: 'CANCELLED' })
    shell(PROMPT)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(pty.writes).toEqual([])
    terminal.dispose()
  })
})
