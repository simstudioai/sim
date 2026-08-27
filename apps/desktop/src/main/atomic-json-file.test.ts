import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FileResourceLimitError,
  readFileWithinLimit,
  readFileWithinLimitSync,
} from '@/main/atomic-json-file'

describe('bounded file reads', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sim-bounded-file-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('reads the file through its opened handle', async () => {
    const filePath = join(directory, 'store.json')
    writeFileSync(filePath, 'bounded payload')

    await expect(readFileWithinLimit(filePath, 15)).resolves.toEqual(Buffer.from('bounded payload'))
    expect(readFileWithinLimitSync(filePath, 15)).toEqual(Buffer.from('bounded payload'))
  })

  it('rejects a file larger than the configured limit', async () => {
    const filePath = join(directory, 'store.json')
    writeFileSync(filePath, 'too large')

    await expect(readFileWithinLimit(filePath, 8)).rejects.toBeInstanceOf(FileResourceLimitError)
    expect(() => readFileWithinLimitSync(filePath, 8)).toThrow(FileResourceLimitError)
  })

  it('rejects non-file handles', async () => {
    const childDirectory = join(directory, 'store')
    mkdirSync(childDirectory)

    await expect(readFileWithinLimit(childDirectory, 100)).rejects.toBeInstanceOf(
      FileResourceLimitError
    )
    expect(() => readFileWithinLimitSync(childDirectory, 100)).toThrow(FileResourceLimitError)
  })
})
