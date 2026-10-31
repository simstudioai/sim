import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FileResourceLimitError,
  readFileWithinLimit,
  readFileWithinLimitSync,
  renameReplacing,
} from '@/main/atomic-json-file'

describe('bounded file reads', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sim-bounded-file-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('rejects a file larger than the configured limit', async () => {
    const filePath = join(directory, 'store.json')
    writeFileSync(filePath, 'too large')

    await expect(readFileWithinLimit(filePath, 8)).rejects.toBeInstanceOf(FileResourceLimitError)
    expect(() => readFileWithinLimitSync(filePath, 8)).toThrow(FileResourceLimitError)
  })
})

describe('renameReplacing', () => {
  const busy = (code: string) => Object.assign(new Error(code), { code })

  function flakyRename(failures: number, code = 'EBUSY') {
    let calls = 0
    const rename = vi.fn(async () => {
      calls += 1
      if (calls <= failures) throw busy(code)
    })
    return rename
  }

  it.each(['EPERM', 'EBUSY', 'EACCES'])(
    'retries a Windows rename that fails with %s until the holder lets go',
    async (code) => {
      const rename = flakyRename(2, code)
      await renameReplacing('from', 'to', { platform: 'win32', rename })
      expect(rename).toHaveBeenCalledTimes(3)
    }
  )

  it('gives up on Windows after a bounded number of attempts', async () => {
    const rename = flakyRename(Number.POSITIVE_INFINITY)
    await expect(renameReplacing('from', 'to', { platform: 'win32', rename })).rejects.toThrow(
      'EBUSY'
    )
    expect(rename).toHaveBeenCalledTimes(5)
  })

  it('does not retry an error a held file cannot cause', async () => {
    const rename = flakyRename(1, 'ENOENT')
    await expect(renameReplacing('from', 'to', { platform: 'win32', rename })).rejects.toThrow(
      'ENOENT'
    )
    expect(rename).toHaveBeenCalledTimes(1)
  })

  it('does not retry on macOS, where these codes mean a real permission failure', async () => {
    const rename = flakyRename(1, 'EACCES')
    await expect(renameReplacing('from', 'to', { platform: 'darwin', rename })).rejects.toThrow(
      'EACCES'
    )
    expect(rename).toHaveBeenCalledTimes(1)
  })
})
