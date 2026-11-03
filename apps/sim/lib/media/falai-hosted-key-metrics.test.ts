import { jsonResponse } from '@sim/testing/helpers/http'
import { inputValidationMock } from '@sim/testing/mocks/input-validation.mock'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { sentMetricData } = vi.hoisted(() => ({
  sentMetricData: [] as Array<{
    MetricName?: string
    Dimensions?: Array<{ Name?: string; Value?: string }>
  }>,
}))

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/lib/core/config/env-flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/config/env-flags')>()),
  isHosted: true,
}))
vi.mock('@aws-sdk/client-cloudwatch', () => ({
  StandardUnit: { Count: 'Count', None: 'None', Milliseconds: 'Milliseconds' },
  PutMetricDataCommand: class {
    constructor(readonly input: { MetricData: typeof sentMetricData }) {}
  },
  CloudWatchClient: class {
    async send(command: { input: { MetricData: typeof sentMetricData } }) {
      sentMetricData.push(...command.input.MetricData)
    }
  },
}))

import { runFalQueue } from '@/lib/media/falai'
import { flushHostedKeyMetrics } from '@/lib/monitoring/metrics'

function stubFalSubmit(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => jsonResponse(body, status))
  )
}

async function failedHostedKeyReasons(): Promise<Array<Record<string, string | undefined>>> {
  await flushHostedKeyMetrics()
  return sentMetricData
    .filter((datum) => datum.MetricName === 'Failed')
    .map((datum) => Object.fromEntries((datum.Dimensions ?? []).map((d) => [d.Name, d.Value])))
}

describe('a fal submit the hosted account refuses', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    sentMetricData.length = 0
  })

  it.each([
    [403, { detail: 'User is locked. Reason: Exhausted balance.' }],
    [401, { detail: 'Invalid API key' }],
  ])('records a hosted-key auth failure for a %i', async (status, body) => {
    stubFalSubmit(status, body)

    await expect(runFalQueue('fal-ai/model', {}, 'key', 'generate_audio')).rejects.toThrow(
      `Fal.ai API error: ${status}`
    )

    expect(await failedHostedKeyReasons()).toEqual([
      expect.objectContaining({ Provider: 'falai', Tool: 'generate_audio', Reason: 'auth' }),
    ])
  })

  it('records nothing when fal rejects the request input', async () => {
    stubFalSubmit(422, { detail: [{ msg: 'field required' }] })

    await expect(runFalQueue('fal-ai/model', {}, 'key', 'generate_video')).rejects.toThrow(
      'Fal.ai API error: 422'
    )

    expect(await failedHostedKeyReasons()).toEqual([])
  })
})
