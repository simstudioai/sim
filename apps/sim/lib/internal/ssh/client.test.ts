import { EventEmitter } from 'node:events'
import type { Client } from 'ssh2'
import { describe, expect, it } from 'vitest'
import { executeSSHCommand } from '@/lib/internal/ssh/client'

function clientEmitting(stdoutChunks: Buffer[]): Client {
  const channel = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    close: () => {},
  })
  return {
    exec: (_command: string, callback: (error: Error | undefined, stream: unknown) => void) => {
      callback(undefined, channel)
      for (const chunk of stdoutChunks) channel.emit('data', chunk)
      channel.emit('close', 0)
    },
  } as unknown as Client
}

describe('executeSSHCommand', () => {
  it('decodes a multi-byte character split across two output chunks', async () => {
    const bytes = Buffer.from('héllo ✓', 'utf8')
    const splitInsideCheckMark = bytes.length - 1
    const result = await executeSSHCommand(
      clientEmitting([
        bytes.subarray(0, splitInsideCheckMark),
        bytes.subarray(splitInsideCheckMark),
      ]),
      'echo'
    )
    expect(result.stdout).toBe('héllo ✓')
  })
})
