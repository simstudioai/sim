/** @vitest-environment node */
import dns from 'node:dns/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { requestOracleFusionJson } from '@/lib/internal/oracle-fusion/client'

vi.unmock('@/lib/core/security/input-validation.server')

afterEach(() => {
  vi.useRealTimers()
})

it('preserves caller cancellation while DNS resolution is pending', async () => {
  vi.useFakeTimers()
  vi.spyOn(dns, 'lookup').mockReturnValue(new Promise(() => {}))
  const controller = new AbortController()
  const reason = new DOMException('cancelled during DNS', 'AbortError')
  const result = requestOracleFusionJson(
    {
      instanceUrl: 'https://vision.fa.us2.oraclecloud.com',
      accessToken: Buffer.from('integration-user:password').toString('base64'),
    },
    { address: { family: 'hcm', relativePath: 'workers' } },
    controller.signal
  ).catch((error: unknown) => error)
  controller.abort(reason)
  await vi.advanceTimersByTimeAsync(1)
  expect(await Promise.race([result, Promise.resolve('pending')])).toBe(reason)
})
