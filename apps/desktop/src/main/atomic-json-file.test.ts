import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

  it('rejects a file larger than the configured limit', async () => {
    const filePath = join(directory, 'store.json')
    writeFileSync(filePath, 'too large')

    await expect(readFileWithinLimit(filePath, 8)).rejects.toBeInstanceOf(FileResourceLimitError)
    expect(() => readFileWithinLimitSync(filePath, 8)).toThrow(FileResourceLimitError)
  })
})
