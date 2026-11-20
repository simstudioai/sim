import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const OUTPUT_BYTES = 4_000_000

/**
 * Runs a deferred write in a real process that prints {@link OUTPUT_BYTES} on stdout after a
 * Ctrl-C arrived, with the reader holding stdout back for a moment, as a slow pipe does.
 */
function interruptedWithBackedUpPipe(): Promise<{ bytes: number; signal: string | null }> {
  const interrupts = join(import.meta.dirname, 'interrupts.ts')
  const io = join(import.meta.dirname, '../output/io.ts')
  const script = `
    const { deferInterrupts } = await import(${JSON.stringify(interrupts)})
    const { writeStdout } = await import(${JSON.stringify(io)})
    await deferInterrupts(async () => {
      process.stderr.write('ready\\n')
      await new Promise((resolve) => setTimeout(resolve, 300))
      writeStdout('x'.repeat(${OUTPUT_BYTES}))
    }, { waiting: 'waiting', abandoned: 'abandoned' })
  `
  const child = spawn('bun', ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] })
  let bytes = 0
  child.stdout.pause()
  child.stdout.on('data', (chunk: Buffer) => {
    bytes += chunk.length
  })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    if (chunk.includes('ready')) {
      child.kill('SIGINT')
      setTimeout(() => child.stdout.resume(), 1_000)
    }
  })
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (_code, signal) => resolve({ bytes, signal }))
  })
}

describe('deferInterrupts', () => {
  it('ends by the held interrupt only after what the write printed reached the pipe', async () => {
    const run = await interruptedWithBackedUpPipe()

    expect(run.bytes).toBe(OUTPUT_BYTES)
    expect(run.signal).toBe('SIGINT')
  }, 15_000)
})
