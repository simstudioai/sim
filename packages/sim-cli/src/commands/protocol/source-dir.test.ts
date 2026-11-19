import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SOURCE_BASE_FILE, SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type EmbedContext, embedStore } from '../../embed-context'
import { EmbeddedOutput } from '../../embed-output'
import { SOURCE_WRITTEN_FILE, updateSourceDir } from './source-dir'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sim-source-dir-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('updateSourceDir', () => {
  it('keeps the old records when a write stops before every source file landed', async () => {
    const records = [SOURCE_BASE_FILE, SOURCE_LOCK_FILE, SOURCE_WRITTEN_FILE]
    for (const path of records) {
      mkdirSync(join(dir, '.sim'), { recursive: true })
      writeFileSync(join(dir, path), 'old')
    }
    // A folder where the workflow file goes: its rename fails, as a kill mid-write would stop it.
    mkdirSync(join(dir, 'workflow.ts', 'blocked'), { recursive: true })

    await expect(
      updateSourceDir(dir, {
        write: [['workflow.ts', 'new text'], ...records.map((path) => [path, 'new'] as const)],
      })
    ).rejects.toThrow()

    for (const path of records) expect(readFileSync(join(dir, path), 'utf8')).toBe('old')
  })

  it('in an embedded run, writes the records after every file, fetched blobs included', async () => {
    const landed: string[] = []
    const host: EmbedContext = {
      identity: { endpoint: 'http://localhost', apiKey: 'test' },
      stdout: new EmbeddedOutput(),
      stderr: new EmbeddedOutput(),
      writeFile: async (path, content) => {
        await new Response(content).arrayBuffer()
        if (path.endsWith('docs/a.pdf')) throw new Error('interrupted')
        landed.push(path.slice(dir.length + 1))
      },
    }
    const records = [SOURCE_BASE_FILE, SOURCE_WRITTEN_FILE]

    await expect(
      embedStore.run(host, () =>
        updateSourceDir(dir, {
          write: [...records.map((path) => [path, 'new'] as const), ['tables/t.ts', 'text']],
          fetch: [['knowledge/k/docs/a.pdf', async (file) => writeFileSync(file, 'pdf')]],
        })
      )
    ).rejects.toThrow('interrupted')

    expect(landed).toEqual(['tables/t.ts'])
  })
})
