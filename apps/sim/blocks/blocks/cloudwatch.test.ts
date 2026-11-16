import { describe, expect, it } from 'vitest'
import { CloudWatchV2Block } from '@/blocks/blocks/cloudwatch'
import type { BlockToolParamsContext } from '@/blocks/types'

const mapParams = CloudWatchV2Block.tools.config?.params
if (!mapParams) {
  throw new Error('CloudWatch block must define tools.config.params')
}

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
})
