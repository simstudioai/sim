/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { tmuxStub } = vi.hoisted(() => ({
  tmuxStub: {
    /** Handles handed out by `startRun`, newest last, with their dispose spies. */
    handles: [] as Array<{ window: string; dispose: ReturnType<typeof vi.fn> }>,
    /** Whether a run's status file is considered present yet. */
    complete: new Set<string>(),
    /** What `awaitRun` reports — the leak is on the `done: false` path. */
    done: false,
  },
}))

vi.mock('@/main/terminal/tmux', () => ({
  TMUX_KEY_NAMES: {},
  activePane: vi.fn(async () => 'sess:0.0'),
  awaitRun: vi.fn(async () => ({
    done: tmuxStub.done,
    output: 'out',
    exitCode: tmuxStub.done ? 0 : null,
  })),
  capturePane: vi.fn(async () => ({ ok: true, stdout: '', stderr: '' })),
  closeRunWindow: vi.fn(async () => undefined),
  isRunComplete: vi.fn((handle: { window: string }) => tmuxStub.complete.has(handle.window)),
  isTmuxUnavailable: vi.fn(() => false),
  killPane: vi.fn(async () => ({ ok: true, stdout: '', stderr: '' })),
  listPanes: vi.fn(async () => []),
  resolveAttachment: vi.fn(async () => ({ session: 'sess' })),
  sendKey: vi.fn(async () => ({ ok: true, stdout: '', stderr: '' })),
  sendText: vi.fn(async () => ({ ok: true, stdout: '', stderr: '' })),
  startRun: vi.fn(async () => {
    const handle = {
      window: `sess:${tmuxStub.handles.length}`,
      outPath: '/tmp/fake/out',
      statusPath: '/tmp/fake/status',
      dispose: vi.fn(),
    }
    tmuxStub.handles.push(handle)
    return handle
  }),
}))

vi.mock('@/main/terminal/session', () => ({
  elide: (text: string) => ({ text, truncated: false }),
  TerminalSession: {
    create: ({ terminalId, cwd }: { terminalId: string; cwd: string }) => ({
      terminalId,
      cols: 80,
      rows: 24,
      pid: 1234,
      env: {},
      shell: 'zsh',
      alive: true,
      currentCwd: cwd,
      foreground: null,
      isBusy: false,
      hasShellIntegration: true,
      dispose: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      setBusy: vi.fn(),
      refreshCwd: async () => {},
      takeReplaySnapshot: () => '',
      tabState: (active: boolean) => ({
        terminalId,
        title: 'zsh',
        cwd,
        running: null,
        interactive: false,
        active,
      }),
    }),
  },
}))

import { TerminalService } from '@/main/terminal'

/**
 * A run whose command outlives the wait window leaves a temp directory behind
 * that only its handle can remove, and nothing polls that run again — `read`
 * captures the tmux pane instead. These cover who eventually disposes it.
 */
describe('pending tmux runs', () => {
  let service: TerminalService

  beforeEach(() => {
    tmuxStub.handles.length = 0
    tmuxStub.complete.clear()
    tmuxStub.done = false
    service = new TerminalService({ loadCwd: () => '/tmp', saveCwd: () => {} })
  })

  it('reclaims a still-running run when the terminal is closed', async () => {
    await service.executeTool('call-1', 'run', { command: 'sleep 600' })

    const [handle] = tmuxStub.handles
    expect(handle.dispose).not.toHaveBeenCalled()

    service.dispose()

    expect(handle.dispose).toHaveBeenCalledTimes(1)
  })

  it('reaps a finished run when the next run starts, and leaves live ones alone', async () => {
    await service.executeTool('call-1', 'run', { command: 'sleep 600' })
    const [first] = tmuxStub.handles

    await service.executeTool('call-2', 'run', { command: 'sleep 600' })
    expect(first.dispose).not.toHaveBeenCalled()

    tmuxStub.complete.add(first.window)
    await service.executeTool('call-3', 'run', { command: 'sleep 600' })

    expect(first.dispose).toHaveBeenCalledTimes(1)
    expect(tmuxStub.handles[1].dispose).not.toHaveBeenCalled()

    service.dispose()
  })

  it('disposes a run inline when it finishes inside the wait window', async () => {
    tmuxStub.done = true
    await service.executeTool('call-1', 'run', { command: 'true' })

    expect(tmuxStub.handles[0].dispose).toHaveBeenCalledTimes(1)

    service.dispose()
    expect(tmuxStub.handles[0].dispose).toHaveBeenCalledTimes(1)
  })
})
