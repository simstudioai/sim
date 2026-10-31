import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { countWindowsWithUnsavedChanges } from '@/main/in-flight-work'

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
