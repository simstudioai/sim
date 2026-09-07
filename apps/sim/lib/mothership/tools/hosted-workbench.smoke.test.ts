/**
 * @vitest-environment node
 * Explicit hosted acceptance: MSHIP_E2B_SMOKE=1, the configured Mship template,
 * and a disposable loopback Redis database. Only uniquely tagged test sandboxes
 * are created or killed. Provider SDK, files, commands and Redis are real.
 */
import { Sandbox } from '@e2b/code-interpreter'
import { setEnv } from '@sim/testing'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import { CodeLanguage } from '@/lib/execution/languages'
import { e2bProvider, stopE2BSessionProcess } from '@/lib/execution/remote-sandbox/e2b'
import { observeSandboxExecution } from '@/lib/execution/remote-sandbox/execution-observer'
import { ensureSessionSandbox } from '@/lib/execution/remote-sandbox/session'
import {
  readSessionSandboxFile,
  writeSessionSandboxFile,
} from '@/lib/execution/remote-sandbox/session-files'
import { withSandboxSessionLock } from '@/lib/execution/remote-sandbox/session-lock'
import { sessionProcessCommand } from '@/lib/execution/remote-sandbox/session-process'
import type { SandboxHandle } from '@/lib/execution/remote-sandbox/types'

vi.unmock('@/lib/core/config/redis')

const enabled = process.env.MSHIP_E2B_SMOKE === '1'
const keys: string[] = []

function sessionKey(): string {
  const key = `mship-hosted-acceptance-${generateId()}`
  keys.push(key)
  return key
}

async function acquire(key: string): Promise<SandboxHandle> {
  return withSandboxSessionLock(key, AbortSignal.timeout(60_000), async (signal) => {
    const { created } = await ensureSessionSandbox({
      provider: e2bProvider,
      kind: 'mothership',
      options: { language: CodeLanguage.Python, lifetimeMs: 60_000 },
      selected: null,
      session: { key },
      signal,
      bootstrapTimeoutMs: 30_000,
    })
    return created.sandbox
  })
}

async function listed(key: string): Promise<string[]> {
  const pages = Sandbox.list({
    query: { metadata: { simSessionKey: key }, state: ['running', 'paused'] },
  })
  const ids: string[] = []
  do {
    ids.push(...(await pages.nextItems()).map((item) => item.sandboxId))
  } while (pages.hasNext)
  return ids
}

describe.skipIf(!enabled)('configured hosted Mship workbench', () => {
  beforeEach(async () => {
    const redis = process.env.MSHIP_E2B_REDIS_URL
    if (!redis || new URL(redis).hostname !== '127.0.0.1' || new URL(redis).pathname !== '/14') {
      throw new Error('Hosted acceptance requires disposable loopback Redis database 14')
    }
    if (!process.env.E2B_API_KEY || !process.env.MOTHERSHIP_E2B_TEMPLATE_ID) {
      throw new Error('Hosted acceptance requires the configured E2B key and Mship template')
    }
    setEnv({
      REDIS_URL: redis,
      CACHE_PROVIDER: 'redis',
      SANDBOX_PROVIDER: 'e2b',
      E2B_ENABLED: 'true',
    })
    expect(await getRedisClient()?.ping()).toBe('PONG')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    try {
      for (const key of keys) {
        for (const id of await listed(key)) await Sandbox.kill(id)
        expect(await listed(key)).toEqual([])
      }
    } finally {
      keys.length = 0
      await closeRedisConnection()
    }
  }, 60_000)

  it('shares concurrent first file/code use, isolates chats, and reconnects with intact bytes', async () => {
    const key = sessionKey()
    const other = sessionKey()
    const binary = new Uint8Array([0, 255, 128, 1, 13, 10])
    const [written, machine, independent] = await Promise.all([
      writeSessionSandboxFile(key, 'input.bin', binary),
      acquire(key),
      acquire(other),
    ])
    expect(written).toEqual({ outcome: 'written', path: '/home/user/input.bin' })
    expect(await listed(key)).toEqual([machine.sandboxId])
    expect(independent.sandboxId).not.toBe(machine.sandboxId)
    const results = await Promise.all([
      machine.runCode(
        "from pathlib import Path\nb = Path('input.bin').read_bytes()\nPath('answer.bin').write_bytes(b[::-1])\nprint(sum(b))",
        { timeoutMs: 20_000 }
      ),
      machine.runCommand('sleep 1; printf parallel > parallel.txt', { timeoutMs: 20_000 }),
      independent.runCommand('test ! -e input.bin && echo isolated', { timeoutMs: 20_000 }),
    ])
    expect(results[0].stdout.trim()).toBe('407')
    expect(results[1].exitCode).toBe(0)
    expect(results[2].stdout.trim()).toBe('isolated')
    const recovered = await e2bProvider.findSessionSandbox?.(key, {})
    expect(recovered?.sandboxId).toBe(machine.sandboxId)
    expect(await readSessionSandboxFile(key, 'answer.bin', 'base64')).toEqual({
      outcome: 'read',
      content: Buffer.from(binary).reverse().toString('base64'),
    })
    expect(await recovered?.readFile('/home/user/parallel.txt')).toBe('parallel')
    const info = await Sandbox.getInfo(machine.sandboxId)
    expect(info.envdVersion).toMatch(/^\d+\.\d+\.\d+$/)
    const streamed = await writeSessionSandboxFile(key, 'stream.bin', new Blob([binary]).stream())
    expect(streamed.outcome).toBe('written')
    expect(await readSessionSandboxFile(key, 'stream.bin', 'base64')).toEqual({
      outcome: 'read',
      content: Buffer.from(binary).toString('base64'),
    })
    await Sandbox.setTimeout(machine.sandboxId, 1000)
    await expect.poll(() => listed(key), { timeout: 15_000, interval: 200 }).toEqual([])
    expect(await readSessionSandboxFile(key, 'answer.bin', 'base64')).toEqual({
      outcome: 'no-session',
    })
  }, 180_000)

  it('cancels one process, preserves siblings, and recovers a recorded orphan', async () => {
    const key = sessionKey()
    const machine = await acquire(key)
    const stopped = new AbortController()
    let notifyStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve
    })
    const settled: string[] = []
    const result = await observeSandboxExecution(
      {
        hold: () => {},
        unsettled: () => {
          throw new Error('Hosted process exit remained uncertain')
        },
        settleProcess: async (id) => {
          settled.push(id)
        },
      },
      async () => {
        const cancelled = machine.runCommand('echo ready; sleep 30; echo leaked > cancelled.txt', {
          timeoutMs: 40_000,
          signal: stopped.signal,
          onStdout: () => notifyStarted?.(),
        })
        await started
        const sibling = machine.runCommand('sleep 1; echo survived > sibling.txt', {
          timeoutMs: 20_000,
        })
        stopped.abort()
        return await Promise.allSettled([cancelled, sibling])
      }
    )
    expect(result[1]).toMatchObject({ status: 'fulfilled', value: { exitCode: 0 } })
    if (result[0].status === 'fulfilled') expect(result[0].value.exitCode).not.toBe(0)
    expect(settled).toHaveLength(2)
    expect(await machine.readFile('/home/user/sibling.txt')).toBe('survived\n')
    expect(
      (await machine.runCommand('test ! -e cancelled.txt', { timeoutMs: 10_000 })).exitCode
    ).toBe(0)
    const raw = await Sandbox.connect(machine.sandboxId)
    const id = generateId()
    const process = await raw.commands.run(
      sessionProcessCommand(id, 'echo ready; sleep 30; echo leaked > orphan.txt', false),
      { user: 'root', background: true, timeoutMs: 40_000 }
    )
    await sleep(300)
    await stopE2BSessionProcess(
      { id, sandboxId: machine.sandboxId, sessionKey: key },
      AbortSignal.timeout(15_000)
    )
    await expect(process.wait()).rejects.toBeDefined()
    expect(
      (
        await machine.runCommand('test ! -e orphan.txt && echo recovered', { timeoutMs: 10_000 })
      ).stdout.trim()
    ).toBe('recovered')
    expect((await acquire(key)).sandboxId).toBe(machine.sandboxId)
  }, 180_000)

  it('recovers a lost allocation acknowledgement and contains disk/output limits', async () => {
    const key = sessionKey()
    const original = Sandbox.create.bind(Sandbox)
    const create = vi.spyOn(Sandbox, 'create').mockImplementationOnce(async (...args) => {
      await original(...args)
      throw new Error('Injected lost allocation acknowledgement')
    })
    await expect(acquire(key)).rejects.toThrow('lost allocation acknowledgement')
    const machine = await acquire(key)
    expect(create).toHaveBeenCalledTimes(1)
    expect(await listed(key)).toEqual([machine.sandboxId])
    create.mockRestore()
    /** The process owns its mount namespace, so fill the bounded mount within that same call. */
    const full = await machine.runCommand(
      "set -e; mkdir -p /tmp/mship-quota; mount -t tmpfs -o size=1m tmpfs /tmp/mship-quota; chmod 777 /tmp/mship-quota; runuser -u user -- python3 -c \"from pathlib import Path; Path('/tmp/mship-quota/large').write_bytes(b'x' * 2097152)\"",
      { rootUser: true, timeoutMs: 20_000 }
    )
    expect(full.exitCode).not.toBe(0)
    expect(full.stderr).toContain('No space left on device')
    await machine.writeFile('/home/user/large.txt', 'x'.repeat(4096))
    await expect(
      machine.readFileWithLimit('/home/user/large.txt', { maxBytes: 1024, encoding: 'utf8' })
    ).rejects.toThrow()
    expect(
      (await machine.runCode("print('still usable')", { timeoutMs: 10_000 })).stdout.trim()
    ).toBe('still usable')
    const timed = await machine.runCommand('sleep 30', { timeoutMs: 200 })
    expect(timed.timedOut).toBe(true)
    expect((await machine.runCommand('echo reused', { timeoutMs: 10_000 })).stdout.trim()).toBe(
      'reused'
    )
  }, 180_000)

  it('surfaces lookup and allocation quota failures and succeeds on a later file write', async () => {
    const key = sessionKey()
    const create = vi.spyOn(Sandbox, 'create')
    const list = vi.spyOn(Sandbox, 'list').mockImplementationOnce(() => {
      throw new Error('Injected E2B lookup unavailable')
    })
    expect(await writeSessionSandboxFile(key, 'quota.txt', 'retained')).toMatchObject({
      outcome: 'error',
      detail: expect.stringContaining('lookup unavailable'),
    })
    expect(create).not.toHaveBeenCalled()
    list.mockRestore()
    create.mockRejectedValueOnce(new Error('Injected E2B 429 sandbox concurrency limit'))
    expect(await writeSessionSandboxFile(key, 'quota.txt', 'retained')).toMatchObject({
      outcome: 'error',
      detail: expect.stringContaining('concurrency limit'),
    })
    expect(create).toHaveBeenCalledTimes(1)
    create.mockRestore()
    expect(await listed(key)).toEqual([])
    expect(await writeSessionSandboxFile(key, 'quota.txt', 'retained')).toMatchObject({
      outcome: 'written',
    })
    expect(await readSessionSandboxFile(key, 'quota.txt')).toEqual({
      outcome: 'read',
      content: 'retained',
    })
  }, 120_000)
})
