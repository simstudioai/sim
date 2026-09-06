/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionFileObserver } from '@/lib/execution/remote-sandbox/session-file-observer'

const { write } = vi.hoisted(() => ({ write: vi.fn() }))
vi.mock('@/lib/execution/remote-sandbox/session-files', () => ({
  resolveSessionPath: (path: string) => `/home/user/${path}`,
  writeSessionSandboxFile: write,
}))

import { applySink } from '@/lib/mothership/agent-cli/sink'

const sink = { kind: 'sandbox-file', path: 'result.json' } as const
const result = { exitCode: 0, stdout: '{"created":"resource"}', stderr: 'a note' }

beforeEach(() => {
  vi.resetAllMocks()
  write.mockResolvedValue({ outcome: 'written', path: '/home/user/result.json' })
})

describe('stdout sink publication', () => {
  it('classifies exactly the stdout being saved and retains stderr', async () => {
    const observe: SessionFileObserver = (_machine, stream) => stream
    const classify = vi.fn(async () => observe)
    const saved = await applySink(sink, 'chat', result, undefined, classify)
    expect(classify).toHaveBeenCalledExactlyOnceWith(result.stdout)
    expect(write).toHaveBeenCalledExactlyOnceWith('chat', sink.path, result.stdout, undefined, {
      overwrite: true,
      observe,
    })
    expect(saved).toMatchObject({ exitCode: 0, stderr: result.stderr })
    expect(saved.stdout).toContain('stdout written')
  })

  it('preserves a completed mutation when source classification fails', async () => {
    const classify = vi.fn(async () => {
      throw new Error('classification failed')
    })
    const saved = await applySink(sink, 'chat', result, undefined, classify)
    expect(saved).toMatchObject({ exitCode: 0, stderr: result.stderr })
    expect(saved.stdout).toContain('Command succeeded')
    expect(saved.stdout).toContain('Do not repeat a mutation')
    expect(saved.stdout).toContain(result.stdout)
    expect(write).not.toHaveBeenCalled()
  })

  it('preserves a completed mutation when the file write cannot be confirmed', async () => {
    write.mockResolvedValue({ outcome: 'error', detail: 'storage unavailable' })
    const saved = await applySink(sink, 'chat', result)
    expect(saved.exitCode).toBe(0)
    expect(saved.stdout).toContain('Command succeeded')
    expect(saved.stdout).toContain(result.stdout)
  })

  it('does not lose completed output when Stop arrives during classification', async () => {
    const controller = new AbortController()
    const classify = async () => {
      controller.abort(new Error('Stopped'))
      controller.signal.throwIfAborted()
      return ((_machine, stream) => stream) satisfies SessionFileObserver
    }
    const saved = await applySink(sink, 'chat', result, controller.signal, classify)
    expect(saved.exitCode).toBe(0)
    expect(saved.stdout).toContain(result.stdout)
    expect(write).not.toHaveBeenCalled()
  })

  it.each(['failed', 'stopped', 'chatless'] as const)(
    'does not prepare or publish a %s sink',
    async (state) => {
      const classify = vi.fn(
        async () => ((_machine, stream) => stream) satisfies SessionFileObserver
      )
      const input = state === 'failed' ? { ...result, exitCode: 1 } : result
      const saved = await applySink(
        sink,
        state === 'chatless' ? null : 'chat',
        input,
        state === 'stopped' ? AbortSignal.abort() : undefined,
        classify
      )
      expect(saved.exitCode).toBe(input.exitCode)
      expect(saved.stdout).toContain(input.stdout)
      expect(classify).not.toHaveBeenCalled()
      expect(write).not.toHaveBeenCalled()
    }
  )
})
