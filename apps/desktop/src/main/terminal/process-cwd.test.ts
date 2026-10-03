import { describe, expect, it } from 'vitest'
import { parseLsofCwd, readProcessCwd } from '@/main/terminal/process-cwd'

describe('parseLsofCwd', () => {
  it('keeps paths containing spaces intact', () => {
    expect(parseLsofCwd('p1\nfcwd\nn/Users/me/My Code/app\n')).toBe('/Users/me/My Code/app')
  })
})

describe('readProcessCwd', () => {
  it('rejects invalid pids without touching the OS', async () => {
    await expect(readProcessCwd(0)).resolves.toBeNull()
    await expect(readProcessCwd(-1)).resolves.toBeNull()
    await expect(readProcessCwd(Number.NaN)).resolves.toBeNull()
  })
})
