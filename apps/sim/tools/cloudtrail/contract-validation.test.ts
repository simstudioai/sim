/**
 * @vitest-environment node
 *
 * Boundary rules the CloudTrail contracts must enforce before a request reaches AWS:
 * positional query parameters may not be silently reshaped, `refreshId` is only meaningful
 * alongside `queryAlias`, and a bare trail name is capped at 128 characters even though the
 * same field accepts a 256-character ARN.
 */
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { awsCloudtrailDescribeQueryContract } from '@/lib/api/contracts/tools/aws/cloudtrail-describe-query'
import { awsCloudtrailDescribeTrailsContract } from '@/lib/api/contracts/tools/aws/cloudtrail-describe-trails'
import { awsCloudtrailGetEventDataStoreContract } from '@/lib/api/contracts/tools/aws/cloudtrail-get-event-data-store'
import { awsCloudtrailGetInsightSelectorsContract } from '@/lib/api/contracts/tools/aws/cloudtrail-get-insight-selectors'
import { awsCloudtrailGetTrailStatusContract } from '@/lib/api/contracts/tools/aws/cloudtrail-get-trail-status'
import { awsCloudtrailListTrailsContract } from '@/lib/api/contracts/tools/aws/cloudtrail-list-trails'
import { awsCloudtrailStartQueryContract } from '@/lib/api/contracts/tools/aws/cloudtrail-start-query'
import { getEventDataStoreTool } from '@/tools/cloudtrail/get_event_data_store'
import { listTrailsTool } from '@/tools/cloudtrail/list_trails'
import type { OutputProperty } from '@/tools/types'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'secret',
}

const QUERY_ID = 'abcdef01-2345-6789-abcd-ef0123456789'
const LONGEST_VALID_NAME = 'a'.repeat(128)
const TOO_LONG_NAME = 'a'.repeat(129)
const LONG_TRAIL_ARN = `arn:aws:cloudtrail:us-east-1:123456789012:trail/${'a'.repeat(100)}`

describe('cloudtrail start query contract', () => {
  it('rejects an empty positional query parameter', () => {
    const result = awsCloudtrailStartQueryContract.body.safeParse({
      ...CONNECTION,
      queryAlias: 'top-errors',
      queryParameters: ['us-east-1', '', '2026-01-01'],
    })

    expect(result.success).toBe(false)
  })

  it('accepts a fully populated positional parameter list', () => {
    const result = awsCloudtrailStartQueryContract.body.safeParse({
      ...CONNECTION,
      queryAlias: 'top-errors',
      queryParameters: ['us-east-1', '2026-01-01'],
    })

    expect(result.success).toBe(true)
  })
})

describe('cloudtrail describe query contract', () => {
  it('rejects refreshId when the query is addressed by queryId', () => {
    const result = awsCloudtrailDescribeQueryContract.body.safeParse({
      ...CONNECTION,
      queryId: QUERY_ID,
      refreshId: '1234567890',
    })

    expect(result.success).toBe(false)
  })

  it('accepts refreshId alongside queryAlias', () => {
    const result = awsCloudtrailDescribeQueryContract.body.safeParse({
      ...CONNECTION,
      queryAlias: 'top-errors',
      refreshId: '1234567890',
    })

    expect(result.success).toBe(true)
  })

  it('accepts queryId on its own', () => {
    const result = awsCloudtrailDescribeQueryContract.body.safeParse({
      ...CONNECTION,
      queryId: QUERY_ID,
    })

    expect(result.success).toBe(true)
  })
})

describe('cloudtrail trail name bounds', () => {
  it('rejects a bare trail name longer than 128 characters on get trail status', () => {
    const result = awsCloudtrailGetTrailStatusContract.body.safeParse({
      ...CONNECTION,
      name: TOO_LONG_NAME,
    })

    expect(result.success).toBe(false)
  })

  it('accepts a 128-character bare trail name on get trail status', () => {
    const result = awsCloudtrailGetTrailStatusContract.body.safeParse({
      ...CONNECTION,
      name: LONGEST_VALID_NAME,
    })

    expect(result.success).toBe(true)
  })

  it('accepts a trail ARN longer than 128 characters on get trail status', () => {
    const result = awsCloudtrailGetTrailStatusContract.body.safeParse({
      ...CONNECTION,
      name: LONG_TRAIL_ARN,
    })

    expect(result.success).toBe(true)
  })

  it('rejects a bare trail name longer than 128 characters on get insight selectors', () => {
    const result = awsCloudtrailGetInsightSelectorsContract.body.safeParse({
      ...CONNECTION,
      trailName: TOO_LONG_NAME,
    })

    expect(result.success).toBe(false)
  })

  it('accepts a trail ARN longer than 128 characters on get insight selectors', () => {
    const result = awsCloudtrailGetInsightSelectorsContract.body.safeParse({
      ...CONNECTION,
      trailName: LONG_TRAIL_ARN,
    })

    expect(result.success).toBe(true)
  })

  it('rejects a bare trail name longer than 128 characters inside trailNameList', () => {
    const result = awsCloudtrailDescribeTrailsContract.body.safeParse({
      ...CONNECTION,
      trailNameList: ['audit-trail', TOO_LONG_NAME],
    })

    expect(result.success).toBe(false)
  })

  it('accepts every trail an account can reach in one describe request', () => {
    const result = awsCloudtrailDescribeTrailsContract.body.safeParse({
      ...CONNECTION,
      trailNameList: Array.from({ length: 200 }, (_, index) => `audit-trail-${index}`),
    })

    expect(result.success).toBe(true)
  })
})

/** Top-level output keys whose contract response schema accepts `null`. */
function nullableResponseKeys(outputSchema: z.ZodObject): string[] {
  return Object.entries(outputSchema.shape)
    .filter(([, schema]) => schema.safeParse(null).success)
    .map(([key]) => key)
    .sort()
}

/** Top-level output keys the tool's published catalog metadata marks nullable. */
function nullableCatalogKeys(outputs: Record<string, OutputProperty>): string[] {
  return Object.entries(outputs)
    .filter(([, property]) => property.nullable === true)
    .map(([key]) => key)
    .sort()
}

describe('cloudtrail output metadata nullability', () => {
  it('matches the list trails response contract', () => {
    const outputSchema = awsCloudtrailListTrailsContract.response.schema.shape.output

    expect(nullableCatalogKeys(listTrailsTool.outputs)).toEqual(nullableResponseKeys(outputSchema))
  })

  it('matches the get event data store response contract', () => {
    const outputSchema = awsCloudtrailGetEventDataStoreContract.response.schema.shape.output

    expect(nullableCatalogKeys(getEventDataStoreTool.outputs)).toEqual(
      nullableResponseKeys(outputSchema)
    )
  })
})
