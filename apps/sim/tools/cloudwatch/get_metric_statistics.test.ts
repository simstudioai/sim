import { describe, expect, it } from 'vitest'
import { awsCloudwatchGetMetricStatisticsContract } from '@/lib/api/contracts/tools/aws/cloudwatch-get-metric-statistics'
import { getMetricStatisticsTool } from '@/tools/cloudwatch/get_metric_statistics'
import { validateRequiredParametersAfterMerge } from '@/tools/utils'

const PARAMS = {
  awsRegion: 'us-east-1',
  awsAccessKeyId: 'AKIAEXAMPLE',
  awsSecretAccessKey: 'secret',
  namespace: 'AWS/EC2',
  metricName: 'CPUUtilization',
  startTime: 1700000000,
  endTime: 1700003600,
  period: 300,
}

function parseRequest(params: Record<string, unknown>) {
  const body = getMetricStatisticsTool.operation.input(params as never)
  return awsCloudwatchGetMetricStatisticsContract.body?.safeParse(body)
}

describe('cloudwatch_get_metric_statistics', () => {
  it('accepts percentile statistics without a standard statistic', () => {
    const params = { ...PARAMS, extendedStatistics: ['p99', 'p95'] }
    expect(() =>
      validateRequiredParametersAfterMerge(
        'cloudwatch_get_metric_statistics',
        getMetricStatisticsTool,
        params
      )
    ).not.toThrow()
    expect(parseRequest(params)?.success).toBe(true)
  })

  it('rejects a request with neither standard nor percentile statistics', () => {
    const result = parseRequest(PARAMS)
    expect(result?.success).toBe(false)
    expect(result?.error?.issues.map((issue) => issue.message)).toEqual([
      'Provide statistics or extendedStatistics',
    ])
  })
})
