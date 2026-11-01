import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { readForegroundProcessGroup } from '@/main/terminal/process-group'

describe.skipIf(process.platform === 'win32')('readForegroundProcessGroup', () => {
  it('reads a shell that has already exited as idle, not unknown', async () => {
    const child = spawn('true')
    await once(child, 'exit')
    const exitedPid = child.pid
    if (exitedPid === undefined) throw new Error('The child never started')

    await expect(readForegroundProcessGroup(exitedPid)).resolves.toEqual({ kind: 'shell' })
  })
})
