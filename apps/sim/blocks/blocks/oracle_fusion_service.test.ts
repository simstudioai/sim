/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { parseOracleFusionServiceInput } from '@/lib/internal/oracle-fusion-service/schema'
import { OracleFusionServiceBlock } from '@/blocks/blocks/oracle_fusion_service'
import {
  oracleFusionServiceAssignServiceRequestTool,
  oracleFusionServiceListServiceRequestsTool,
  oracleFusionServiceRunQueueAssignmentTool,
  oracleFusionServiceTransitionServiceRequestStatusTool,
  oracleFusionServiceUpdateServiceRequestTool,
} from '@/tools/oracle_fusion_service'
import type { OracleFusionServiceParams } from '@/tools/oracle_fusion_service/types'

function mapped(operation: string, values: Record<string, unknown>): OracleFusionServiceParams {
  const params = OracleFusionServiceBlock.tools.config?.params?.({
    operation,
    oauthCredential: 'credential',
    ...values,
  })
  return {
    ...params,
    oauthCredential: 'credential',
    accessToken: Buffer.from('user:password').toString('base64'),
    instanceUrl: 'https://vision.fa.us2.oraclecloud.com',
  }
}

describe('Fusion Service block-to-operation behavior', () => {
  it.each([
    {
      operation: 'oracle_fusion_service_update_service_request',
      tool: oracleFusionServiceUpdateServiceRequestTool,
      field: 'problemDescription',
      extra: { srNumber: 'SR1', title: 'Changed' },
    },
    {
      operation: 'oracle_fusion_service_transition_service_request_status',
      tool: oracleFusionServiceTransitionServiceRequestStatusTool,
      field: 'resolveDescription',
      extra: { srNumber: 'SR1', statusCode: 'CUSTOM_DONE' },
    },
  ] as const)(
    'preserves explicit clearing but omits unset $field',
    ({ operation, tool, field, extra }) => {
      for (const value of ['', 'Existing text', undefined, null]) {
        const input = tool.operation.input(mapped(operation, { ...extra, [field]: value }))
        expect(parseOracleFusionServiceInput(operation, input)[field]).toBe(value ?? undefined)
      }
    }
  )

  it('converts pagination while preserving an exact ID and dropping stale operation fields', () => {
    const params = mapped('oracle_fusion_service_list_service_requests', {
      limit: '25',
      offset: '50',
      totalResults: 'false',
      statusCode: 'STALE_STATUS',
      title: 'stale title',
    })
    const input = oracleFusionServiceListServiceRequestsTool.operation.input(params)
    expect(
      parseOracleFusionServiceInput('oracle_fusion_service_list_service_requests', input)
    ).toMatchObject({ limit: 25, offset: 50, totalResults: false })
    expect(input).not.toHaveProperty('statusCode')
    expect(input).not.toHaveProperty('title')
  })

  it('does not silently replace invalid pagination with defaults', () => {
    const input = oracleFusionServiceListServiceRequestsTool.operation.input(
      mapped('oracle_fusion_service_list_service_requests', { limit: 'not-a-number' })
    )
    expect(() =>
      parseOracleFusionServiceInput('oracle_fusion_service_list_service_requests', input)
    ).toThrow()
  })

  it('preserves opaque request numbers and large assignment IDs without numeric coercion', () => {
    const input = oracleFusionServiceAssignServiceRequestTool.operation.input(
      mapped('oracle_fusion_service_assign_service_request', {
        srNumber: 'SR 42',
        resourcePartyId: '999999999999999999',
        queueId: '',
        title: 'stale',
      })
    )
    expect(
      parseOracleFusionServiceInput('oracle_fusion_service_assign_service_request', input)
    ).toMatchObject({ srNumber: 'SR 42', resourcePartyId: '999999999999999999' })
    expect(input).not.toHaveProperty('title')
    expect(input).toHaveProperty('queueId', undefined)
  })

  it('preserves the explicit false automatic-routing override', () => {
    const input = oracleFusionServiceRunQueueAssignmentTool.operation.input(
      mapped('oracle_fusion_service_run_queue_assignment', {
        srNumber: 'SR1',
        overrideQueue: 'false',
      })
    )
    expect(
      parseOracleFusionServiceInput('oracle_fusion_service_run_queue_assignment', input)
    ).toMatchObject({ overrideQueue: false })
  })
})
