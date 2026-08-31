import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@sim/logger', () => ({ createLogger: () => mockLogger }))
vi.mock('electron', () => import('@/test/electron-mock'))

import { app, dialog } from 'electron'
import { createEventLog, installMainProcessFailureObservers, scrubUrl } from '@/main/observability'

describe('scrubUrl', () => {
  it('drops query strings and fragments so tokens never reach the log', () => {
    expect(scrubUrl('https://sim.ai/desktop/auth?state=SECRET&token=SECRET#frag')).toBe(
      'https://sim.ai/desktop/auth'
    )
  })

  it('returns empty for unparseable input', () => {
    expect(scrubUrl('not a url')).toBe('')
  })
})

describe('createEventLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('appends JSONL entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sim-desktop-events-'))
    const events = createEventLog(dir)
    events.record('app_launch', { version: '1.0.0' })
    events.record('load_failure', { kind: 'dns' })

    const lines = readFileSync(events.filePath, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    const first = JSON.parse(lines[0])
    expect(first.name).toBe('app_launch')
    expect(first.data).toEqual({ version: '1.0.0' })
    expect(typeof first.at).toBe('string')
  })

  it('rotates once past the size cap', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sim-desktop-events-'))
    const events = createEventLog(dir, 64)
    events.record('app_launch', { version: '1.0.0' })
    events.record('app_launch', { version: '1.0.0' })
    events.record('app_launch', { version: '1.0.0' })
    expect(existsSync(`${events.filePath}.1`)).toBe(true)
    expect(statSync(`${events.filePath}.1`).mode & 0o777).toBe(0o600)
  })

  it('creates its directory and log with private permissions', () => {
    const root = mkdtempSync(join(tmpdir(), 'sim-desktop-events-'))
    const dir = join(root, 'logs')
    const events = createEventLog(dir)
    events.record('app_launch')

    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(statSync(events.filePath).mode & 0o777).toBe(0o600)
  })

  it('tightens permissions on existing logs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sim-desktop-events-'))
    const filePath = join(dir, 'desktop-events.log')
    const rotatedFilePath = `${filePath}.1`
    writeFileSync(filePath, 'current\n')
    writeFileSync(rotatedFilePath, 'rotated\n')
    chmodSync(dir, 0o755)
    chmodSync(filePath, 0o644)
    chmodSync(rotatedFilePath, 0o644)

    createEventLog(dir)

    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(statSync(filePath).mode & 0o777).toBe(0o600)
    expect(statSync(rotatedFilePath).mode & 0o777).toBe(0o600)
  })

  it('reports permission failures without exposing local paths or OS errors', () => {
    const root = mkdtempSync(join(tmpdir(), 'sim-desktop-events-'))
    const overlongDir = join(root, 'x'.repeat(300))

    createEventLog(overlongDir)

    expect(mockLogger.warn.mock.calls).toEqual([
      ['Could not apply private desktop event-log permissions', { target: 'directory' }],
      ['Could not apply private desktop event-log permissions', { target: 'current-log' }],
      ['Could not apply private desktop event-log permissions', { target: 'rotated-log' }],
    ])
    expect(JSON.stringify(mockLogger.warn.mock.calls)).not.toContain(root)
    expect(JSON.stringify(mockLogger.warn.mock.calls)).not.toContain('ENAMETOOLONG')
  })
})

describe('installMainProcessFailureObservers', () => {
  function createProcessSource() {
    const handlers = new Map<string, (...args: never[]) => void>()
    return {
      handlers,
      source: {
        on: vi.fn((event: string, handler: (...args: never[]) => void) => {
          handlers.set(event, handler)
        }),
      },
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records unexpected child-process exits once per failure burst', () => {
    vi.useFakeTimers()
    try {
      const events = { filePath: '/tmp/events.log', record: vi.fn() }
      const { source } = createProcessSource()
      installMainProcessFailureObservers({ events, getWindow: () => null, processSource: source })
      const appHandlers = vi.mocked(app.on).mock.calls as unknown as Array<
        [string, (...args: never[]) => void]
      >
      const handler = appHandlers.find(([event]) => event === 'child-process-gone')?.[1] as
        | ((event: unknown, details: Record<string, unknown>) => void)
        | undefined
      const details = { type: 'GPU', reason: 'crashed', exitCode: 9, serviceName: 'GPU' }

      handler?.({}, details)
      handler?.({}, details)

      expect(events.record).toHaveBeenCalledOnce()
      expect(events.record).toHaveBeenCalledWith('child_process_gone', details)

      vi.advanceTimersByTime(5_000)
      handler?.({}, details)
      expect(events.record).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows one recovery prompt for simultaneous fatal failures', async () => {
    let resolvePrompt: ((value: { response: number; checkboxChecked: boolean }) => void) | undefined
    vi.mocked(dialog.showMessageBox).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePrompt = resolve
        })
    )
    const events = { filePath: '/tmp/events.log', record: vi.fn() }
    const { handlers, source } = createProcessSource()
    installMainProcessFailureObservers({ events, getWindow: () => null, processSource: source })

    const fatalError = new Error('secret')
    fatalError.name = 'Bearer SECRET'
    handlers.get('unhandledRejection')?.(fatalError as never)
    handlers.get('uncaughtException')?.(new Error('second') as never)

    expect(dialog.showMessageBox).toHaveBeenCalledOnce()
    expect(events.record).toHaveBeenCalledOnce()
    expect(events.record).toHaveBeenCalledWith('main_unhandled_rejection', {
      valueType: 'Error',
    })
    expect(JSON.stringify(events.record.mock.calls)).not.toContain('SECRET')

    resolvePrompt?.({ response: 0, checkboxChecked: false })
    await vi.waitFor(() => expect(app.relaunch).toHaveBeenCalledOnce())
    expect(app.exit).toHaveBeenCalledWith(1)
  })
})
