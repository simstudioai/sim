import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  combineChatAttachments,
  loadChatAttachment,
  loadChatAttachments,
} from './chat-attachments.js'

const temporaryDirectories: string[] = []

function pngBytes(size: number): Buffer {
  const bytes = Buffer.alloc(size)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes)
  return bytes
}

async function fixture(name: string, value: Uint8Array | string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'sim-cli-chat-test-'))
  temporaryDirectories.push(directory)
  const path = join(directory, name)
  await writeFile(path, value)
  return path
}

afterEach(async () => {
  for (const path of temporaryDirectories.splice(0)) await rm(path, { recursive: true })
})

describe('chat attachments', () => {
  it('infers media types from bytes and sends only the basename', async () => {
    const png = await fixture(
      'renamed.dat',
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
    const markdown = await fixture('notes.md', '# hello')

    await expect(loadChatAttachment(png)).resolves.toEqual({
      name: 'renamed.dat',
      mediaType: 'image/png',
      data: 'iVBORw0KGgo=',
    })
    await expect(loadChatAttachment(markdown)).resolves.toEqual({
      name: 'notes.md',
      mediaType: 'text/markdown',
      data: 'IyBoZWxsbw==',
    })
  })

  it('rejects binary and oversized text locally', async () => {
    const binary = await fixture('payload.bin', Uint8Array.from([0xff, 0x00, 0xfe]))
    const large = await fixture('large.txt', 'x'.repeat(200 * 1024 + 1))
    const tooLargeForAnyType = await fixture('huge.png', Buffer.alloc(5 * 1024 * 1024 + 1))

    await expect(loadChatAttachment(binary)).rejects.toThrow(/Unsupported attachment/)
    await expect(loadChatAttachment(large)).rejects.toThrow(/200 KiB/)
    await expect(loadChatAttachment(tooLargeForAnyType)).rejects.toThrow(/5 MiB/)
  })

  it('enforces count and aggregate limits', async () => {
    const small = { name: 'a.txt', mediaType: 'text/plain', data: 'eA==' }
    expect(() =>
      combineChatAttachments(
        [],
        Array.from({ length: 6 }, () => small)
      )
    ).toThrow(/at most 5/)

    const fiveMiB = Buffer.alloc(5 * 1024 * 1024).toString('base64')
    expect(() =>
      combineChatAttachments(
        [],
        [
          { name: 'a.png', mediaType: 'image/png', data: fiveMiB },
          { name: 'b.png', mediaType: 'image/png', data: fiveMiB },
          { name: 'c.txt', mediaType: 'text/plain', data: 'eA==' },
        ]
      )
    ).toThrow(/aggregate limit/)
  })

  it('loads multiple attachments and rejects missing paths', async () => {
    const one = await fixture('one.txt', 'one')
    const two = await fixture('two.json', '{}')
    await expect(loadChatAttachments([one, two])).resolves.toHaveLength(2)
    await expect(loadChatAttachment(join(tmpdir(), 'definitely-missing-sim-file'))).rejects.toThrow(
      /Could not read attachment/
    )
  })

  it('rejects too many paths before attempting to open any of them', async () => {
    const missing = join(tmpdir(), 'definitely-missing-sim-file')

    await expect(loadChatAttachments(Array.from({ length: 6 }, () => missing))).rejects.toThrow(
      /at most 5/
    )
  })

  it('stops loading as soon as the aggregate byte limit is exceeded', async () => {
    const first = await fixture('first.png', pngBytes(5 * 1024 * 1024))
    const second = await fixture('second.png', pngBytes(5 * 1024 * 1024))
    const third = await fixture('third.png', pngBytes(8))
    const missing = join(tmpdir(), 'missing-after-aggregate-limit.png')

    await expect(loadChatAttachments([first, second, third, missing])).rejects.toThrow(
      /aggregate limit/
    )
  })
})
