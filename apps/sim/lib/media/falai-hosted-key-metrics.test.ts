import { jsonResponse } from '@sim/testing/helpers/http'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { inputValidationMock } from '@sim/testing/mocks/input-validation.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { sentMetricData } = vi.hoisted(() => ({
  sentMetricData: [] as Array<{
    MetricName?: string
    Dimensions?: Array<{ Name?: string; Value?: string }>
  }>,
}))

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
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

async function failedHostedKeyDimensions(): Promise<Array<Record<string, string | undefined>>> {
  await flushHostedKeyMetrics()
  return sentMetricData
    .filter((datum) => datum.MetricName === 'Failed')
    .map((datum) => Object.fromEntries((datum.Dimensions ?? []).map((d) => [d.Name, d.Value])))
}

describe('a fal submit the hosted account refuses', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setEnvFlags({ isHosted: true })
    sentMetricData.length = 0
  })

  afterEach(() => {
    vi.useRealTimers()
    resetEnvFlagsMock()
  })

  it.each([
    [403, { detail: 'User is locked. Reason: Exhausted balance.' }],
    [401, { detail: 'Invalid API key' }],
  ])('records a hosted-key auth failure against the refused key for a %i', async (status, body) => {
    stubFalSubmit(status, body)

    await expect(
      runFalQueue('fal-ai/model', {}, 'key', {
        tool: 'generate_audio',
        envVarName: 'FALAI_API_KEY_2',
      })
    ).rejects.toThrow(`Fal.ai API error: ${status}`)

    expect(await failedHostedKeyDimensions()).toEqual([
      expect.objectContaining({
        Provider: 'falai',
        Tool: 'generate_audio',
        Key: 'FALAI_API_KEY_2',
        Reason: 'auth',
      }),
    ])
  })

  it('records nothing when fal rejects the request input', async () => {
    stubFalSubmit(422, { detail: [{ msg: 'field required' }] })

    await expect(
      runFalQueue('fal-ai/model', {}, 'key', {
        tool: 'generate_video',
        envVarName: 'FALAI_API_KEY_1',
      })
    ).rejects.toThrow('Fal.ai API error: 422')

    expect(await failedHostedKeyDimensions()).toEqual([])
  })
})
