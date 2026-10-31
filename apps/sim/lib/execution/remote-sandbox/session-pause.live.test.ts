/**
 * Idle session sandboxes against the real E2B control plane: a workbench pauses when its lease
 * runs out instead of dying, a reconnect resumes it with its files, and the retention sweep's kill
 * spares a sandbox that is running or paused too recently.
 *
 * Enable with `SANDBOX_SESSION_SMOKE=1`. Requires `E2B_API_KEY` and `MOTHERSHIP_E2B_TEMPLATE_ID`.
 * Creates one short-lived sandbox and always kills it.
 */
import { sleep } from '@sim/utils/helpers'
import { generateShortId } from '@sim/utils/id'
import { describe, expect, it } from 'vitest'
import { e2bProvider } from '@/lib/execution/remote-sandbox/e2b'
import type { PausedSessionSandbox } from '@/lib/execution/remote-sandbox/types'

const smokeEnabled = process.env.SANDBOX_SESSION_SMOKE === '1'
const LEASE_MS = 15_000
const PAUSE_WAIT_MS = 90_000

/** The paused list trails resumes, so a later pause must be newer than `after`. */
async function waitForPause(sessionKey: string, after = 0): Promise<PausedSessionSandbox> {
  const deadline = Date.now() + PAUSE_WAIT_MS
  while (Date.now() < deadline) {
    const paused = await e2bProvider.listPausedSessionSandboxes?.()
    const match = paused?.find(
      (sandbox) => sandbox.sessionKey === sessionKey && sandbox.pausedAtMs > after
    )
    if (match) return match
    await sleep(2_000)
  }
  throw new Error(`Session sandbox ${sessionKey} did not pause within ${PAUSE_WAIT_MS}ms`)
}

describe.skipIf(!smokeEnabled)('session sandbox pause smoke', () => {
  it(
    'pauses an idle workbench, resumes it intact, and reaps it only once expired',
    async () => {
      const apiKey = process.env.E2B_API_KEY
      if (!apiKey) throw new Error('E2B_API_KEY is required')
      const sessionKey = `mothership-chat:live-pause-${generateShortId(10)}`
      const created = await e2bProvider.create('mothership', { sessionKey, lifetimeMs: LEASE_MS })
      const { Sandbox } = await import('@e2b/code-interpreter')
      try {
        await created.writeFile('/home/user/marker.txt', 'kept')

        const paused = await waitForPause(sessionKey)
        expect(paused.sandboxId).toBe(created.sandboxId)
        expect(paused.pausedAtMs).toBeLessThanOrEqual(Date.now())
        expect(await e2bProvider.killPausedSessionSandbox?.(paused, paused.pausedAtMs - 1)).toBe(
          false
        )

        const resumed = await e2bProvider.findSessionSandbox?.(sessionKey, { lifetimeMs: LEASE_MS })
        expect(resumed?.sandboxId).toBe(created.sandboxId)
        const marker = await resumed?.readFileWithLimit('/home/user/marker.txt', {
          maxBytes: 64,
          encoding: 'utf8',
        })
        expect(marker?.content).toBe('kept')
        expect(await e2bProvider.killPausedSessionSandbox?.(paused, Date.now())).toBe(false)

        // A reconnect grants at least the idle lease, so pause directly rather than wait it out.
        await Sandbox.pause(created.sandboxId, { apiKey })
        const pausedAgain = await waitForPause(sessionKey, paused.pausedAtMs)
        expect(await e2bProvider.killPausedSessionSandbox?.(pausedAgain, Date.now())).toBe(true)
      } finally {
        await Sandbox.kill(created.sandboxId, { apiKey })
      }
    },
    5 * 60_000
  )
})
