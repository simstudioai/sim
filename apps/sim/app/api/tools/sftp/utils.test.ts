/**
 * @vitest-environment node
 */
import { Readable } from 'stream'
import type { SFTPWrapper } from 'ssh2'
import { describe, expect, it, vi } from 'vitest'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { MAX_SFTP_READ_BYTES, readSftpFileCapped } from '@/app/api/tools/sftp/utils'

/**
 * Builds a fake SFTP wrapper whose read stream emits `chunkCount` chunks of
 * `chunkSize` bytes — the shape of a malicious server that understates the
 * file size in its stat reply and then streams unbounded data.
 */
function fakeSftp(chunkSize: number, chunkCount: number) {
  let emitted = 0
  const stream = new Readable({
    read() {
      if (emitted >= chunkCount) {
        this.push(null)
        return
      }
      emitted++
      this.push(Buffer.alloc(chunkSize, 0x41))
    },
  })
  const createReadStream = vi.fn(() => stream)
  return { sftp: { createReadStream } as unknown as SFTPWrapper, stream, createReadStream }
}

describe('readSftpFileCapped', () => {
  it('resolves with the full contents when under the cap', async () => {
    const { sftp, createReadStream } = fakeSftp(4, 3)

    const buffer = await readSftpFileCapped(sftp, '/file', 1024, 'file')

    expect(buffer.toString()).toBe('A'.repeat(12))
    expect(createReadStream).toHaveBeenCalledWith('/file')
  })

  it('rejects and destroys the stream once received bytes exceed the cap', async () => {
    const { sftp, stream } = fakeSftp(8, 1_000_000)

    await expect(readSftpFileCapped(sftp, '/bomb', 16, 'file')).rejects.toSatisfy(
      isPayloadSizeLimitError
    )
    expect(stream.destroyed).toBe(true)
  })

  it('enforces the cap on actual bytes even when the file was reported as tiny', async () => {
    const { sftp, stream } = fakeSftp(1024, 1_000_000)

    await expect(readSftpFileCapped(sftp, '/bomb', 4096, 'file')).rejects.toThrow(
      /exceeds maximum size of 4096 bytes/
    )
    expect(stream.destroyed).toBe(true)
  })

  it('survives the late stream error ssh2 emits when the channel closes after an abort', async () => {
    const { sftp, stream } = fakeSftp(8, 1_000_000)

    await expect(readSftpFileCapped(sftp, '/bomb', 16, 'file')).rejects.toSatisfy(
      isPayloadSizeLimitError
    )

    expect(() => stream.emit('error', new Error('No response from server'))).not.toThrow()
  })

  it('caps remote reads at 50MB', () => {
    expect(MAX_SFTP_READ_BYTES).toBe(50 * 1024 * 1024)
  })
})
