import type { Ec2ConnectionParams } from '@/tools/ec2/types'

export function ec2ConnectionInput(params: Ec2ConnectionParams) {
  return {
    region: params.awsRegion,
    accessKeyId: params.awsAccessKeyId,
    secretAccessKey: params.awsSecretAccessKey,
  }
}

/**
 * Drops optional params that carry no value. A direct LLM tool call can pass `null` or an
 * empty string for a param it means to omit, which would otherwise fail input validation.
 */
export function suppliedParams(params: Record<string, unknown>): Record<string, unknown> {
  const supplied: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') supplied[key] = value
  }
  return supplied
}
