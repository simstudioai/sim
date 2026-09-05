/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createFccsContext,
  parseFccsInput,
  projectFccsResponse,
} from '@/lib/internal/oracle-epm-fccs/context'
import { fccsName } from '@/lib/internal/oracle-epm-fccs/schemas'

const auth = {
  accessToken: Buffer.from('user:secret').toString('base64'),
  instanceUrl: 'https://epm.example.com/gateway',
}
describe('FCCS execution boundary', () => {
  it('requires system-injected credential material, not just a selected ID', () => {
    expect(() => createFccsContext({ oauthCredential: 'id' })).toThrow('service account')
    const execution = {
      userId: 'trusted-user',
      workspaceId: 'trusted-workspace',
      workflowId: 'trusted-workflow',
    }
    const signal = new AbortController().signal
    const result = createFccsContext(auth, signal, execution)
    expect(result.signal).toBe(signal)
    expect(result.execution).toBe(execution)
  })
  it('honors cancellation before creating any provider client', () => {
    const signal = AbortSignal.abort(new DOMException('stopped', 'AbortError'))
    expect(() => createFccsContext(auth, signal)).toThrow('stopped')
  })
  it('preserves literal inputs and does not echo invalid values', () => {
    expect(
      parseFccsInput(z.object({ member: fccsName }), { member: ' Actual %20 ', other: 'hidden' })
    ).toEqual({ member: ' Actual %20 ' })
    expect(() =>
      parseFccsInput(z.object({ member: fccsName }), { member: { secret: 'canary' } })
    ).toThrow(/^Invalid FCCS input: member$/)
  })
  it('never returns unknown provider fields or validation diagnostics', () => {
    expect(
      projectFccsResponse(z.object({ name: z.string() }), {
        data: { name: 'Close', secret: 'canary' },
        status: 200,
      } as never)
    ).toEqual({ name: 'Close' })
    expect(() =>
      projectFccsResponse(z.object({ name: z.string() }), {
        data: { name: { secret: 'canary' } },
        status: 200,
      } as never)
    ).toThrow(/^Oracle EPM FCCS returned an undocumented or malformed response$/)
  })
})
