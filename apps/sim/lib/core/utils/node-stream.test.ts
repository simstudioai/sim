import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { isRetryableInfrastructureError } from '@/lib/core/errors/retryable-infrastructure'
import { nodeReadableToWebStream } from '@/lib/core/utils/node-stream'

describe('nodeReadableToWebStream', () => {
  it('marks an errorless premature close as retryable instead of completing a partial body', async () => {
    const source = new PassThrough()
    const reading = new Response(nodeReadableToWebStream(source)).text()
    const rejected = expect(reading).rejects.toMatchObject({ code: 'ERR_STREAM_PREMATURE_CLOSE' })
    source.write('partial')
    source.destroy()
    await rejected
    expect(await reading.catch(isRetryableInfrastructureError)).toBe(true)
  })

  it('preserves the original source error', async () => {
    const source = new PassThrough()
    const reading = new Response(nodeReadableToWebStream(source)).text()
    const error = new Error('Source failed')
    const rejected = expect(reading).rejects.toBe(error)
    source.destroy(error)
    await rejected
  })
})
