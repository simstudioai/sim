import { describe, expect, it } from 'vitest'
import { CloudWatchV2Block } from '@/blocks/blocks/cloudwatch'
import type { BlockToolParamsContext } from '@/blocks/types'

const configuredParams = CloudWatchV2Block.tools.config?.params
if (!configuredParams) {
  throw new Error('CloudWatch block must define tools.config.params')
}
const mapParams = configuredParams

/** The tool-call merge: the mapped params land over the model's args (`{ ...args, ...mapped }`). */
function merge(args: Record<string, unknown>, context?: BlockToolParamsContext) {
  return { ...args, ...mapParams(args, context) }
}

describe('CloudWatch block params', () => {
  it('publishes a metric from model args named by the tool when the operation is only in the context', () => {
    const merged = merge(
      { namespace: 'Custom/App', metricName: 'Hits', value: 3 },
      { operation: 'put_metric_data' }
    )

    expect(merged.namespace).toBe('Custom/App')
    expect(merged.metricName).toBe('Hits')
    expect(merged.value).toBe(3)
  })
  it('splits a comma-separated extendedStatistics the model sent without statistics', () => {
    const merged = merge(
      {
        namespace: 'AWS/EC2',
        metricName: 'CPUUtilization',
        startTime: 1700000000,
        endTime: 1700003600,
        period: 300,
        extendedStatistics: 'p99, p95',
      },
      { operation: 'get_metric_statistics' }
    )

    expect(merged.extendedStatistics).toEqual(['p99', 'p95'])
    expect(merged.statistics).toBeUndefined()
  })
})
