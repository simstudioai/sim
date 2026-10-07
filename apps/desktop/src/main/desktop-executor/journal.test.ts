import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { createExecutorJournal } from '@/main/desktop-executor/journal'

function testEncryption(available = true) {
  return {
    isEncryptionAvailable: vi.fn(() => available),
    encryptString: vi.fn((value: string) => Buffer.from(`protected:${value}`, 'utf8')),
    decryptString: vi.fn((value: Buffer) => value.toString('utf8').replace(/^protected:/, '')),
  }
}

async function journalPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'sim-executor-journal-')), 'journal.json')
}

const RESULT = {
  toolCallId: 'call-1',
  state: 'result' as const,
  executionToken: 'token-1',
  completion: { status: 'success' as const, message: 'done', data: { secret: 'page text' } },
}

describe('executor journal', () => {
  it('survives a restart, encrypted at rest', async () => {
    const filePath = await journalPath()
    const encryption = testEncryption()
    await createExecutorJournal(filePath, encryption).put(RESULT)

    const raw = await readFile(filePath, 'utf8')
    expect(raw).not.toContain('page text')
    expect(raw).not.toContain('token-1')
    await expect(createExecutorJournal(filePath, encryption).load()).resolves.toEqual([RESULT])
  })

  it('removes the file once every call is acknowledged', async () => {
    const filePath = await journalPath()
    const journal = createExecutorJournal(filePath, testEncryption())
    await journal.put(RESULT)
    await journal.remove('call-1')

    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('applies transitions in order, so an earlier write cannot resurrect a removed call', async () => {
    const filePath = await journalPath()
    const encryption = testEncryption()
    const journal = createExecutorJournal(filePath, encryption)
    await Promise.all([
      journal.put({ toolCallId: 'call-1', state: 'claimed', executionToken: 'token-1' }),
      journal.put(RESULT),
      journal.remove('call-1'),
    ])

    await expect(createExecutorJournal(filePath, encryption).load()).resolves.toEqual([])
  })

  it('writes nothing in plaintext when OS encryption is unavailable', async () => {
    const filePath = await journalPath()
    const journal = createExecutorJournal(filePath, testEncryption(false))
    await journal.put(RESULT)

    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports a transition it could not make durable', async () => {
    const encryption = testEncryption()
    encryption.encryptString.mockImplementation(() => {
      throw new Error('keychain locked')
    })

    await expect(
      createExecutorJournal(await journalPath(), encryption).put(RESULT)
    ).rejects.toThrow('keychain locked')
  })

  it('keeps results within what a restart can read back, dropping the data of the excess', async () => {
    const filePath = await journalPath()
    const encryption = testEncryption()
    const journal = createExecutorJournal(filePath, encryption)
    const screenshot = 'x'.repeat(20 * 1024 * 1024)
    for (const toolCallId of ['call-1', 'call-2']) {
      await journal.put({
        toolCallId,
        state: 'result',
        executionToken: `token-${toolCallId}`,
        completion: { status: 'success', message: 'done', data: { screenshot } },
      })
    }

    const restored = await createExecutorJournal(filePath, encryption).load()
    expect(restored).toHaveLength(2)
    const kept = restored.filter(
      (entry) => entry.state === 'result' && entry.completion.data?.screenshot === screenshot
    )
    expect(kept).toHaveLength(1)
    expect(JSON.stringify(restored)).toContain('resultOmitted')
  })

  it('budgets results by their encoded size, not their length in characters', async () => {
    const filePath = await journalPath()
    const encryption = testEncryption()
    const journal = createExecutorJournal(filePath, encryption)
    // Three bytes per character: within the budget by length, three times over it in bytes.
    const pageText = '€'.repeat(6 * 1024 * 1024)
    for (const toolCallId of ['call-1', 'call-2', 'call-3']) {
      await journal.put({
        toolCallId,
        state: 'result',
        executionToken: `token-${toolCallId}`,
        completion: { status: 'success', message: 'done', data: { pageText } },
      })
    }

    const restored = await createExecutorJournal(filePath, encryption).load()
    expect(restored).toHaveLength(3)
    const kept = restored.filter(
      (entry) => entry.state === 'result' && entry.completion.data?.pageText === pageText
    )
    expect(kept).toHaveLength(1)
  })

  it('starts empty from a corrupt or foreign file instead of failing', async () => {
    const filePath = await journalPath()
    await writeFile(filePath, '{"version":1,"ciphertext":"not-base64-json"}')

    await expect(createExecutorJournal(filePath, testEncryption()).load()).resolves.toEqual([])
  })
})
