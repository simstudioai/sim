import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

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
})

describe('createEventLog', () => {
  it('creates its directory and log with private permissions', () => {
    const root = mkdtempSync(join(tmpdir(), 'sim-desktop-events-'))
    const dir = join(root, 'logs')
    const events = createEventLog(dir)
    events.record('app_launch')

    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(statSync(events.filePath).mode & 0o777).toBe(0o600)
  })

  it('reports permission failures without exposing local paths or OS errors', () => {
    const root = mkdtempSync(join(tmpdir(), 'sim-desktop-events-'))
    const overlongDir = join(root, 'x'.repeat(300))

    const events = createEventLog(overlongDir)
    events.record('app_launch')

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
