/**
 * An Agent tool call runs the block mapper over `{ ...storedRowParams, ...modelArgs }` with the
 * operation only in `context`; the tool then receives `{ ...merged, ...mapped }`.
 */
import { describe, expect, it } from 'vitest'
import { VercelBlock } from '@/blocks/blocks/vercel'

function toolCallParams(args: Record<string, unknown>, operation: string) {
  const mapped = VercelBlock.tools.config?.params?.(args, { operation }) ?? {}
  return { ...args, ...mapped }
}

describe('Vercel on an Agent tool call', () => {
  it('keeps the domain the model supplied', () => {
    expect(
      toolCallParams({ apiKey: 'tok', domain: 'example.com' }, 'list_dns_records')
    ).toMatchObject({ domain: 'example.com' })
  })

  it('sends Create Check blocking as a boolean', () => {
    expect(
      toolCallParams(
        { apiKey: 'tok', deploymentId: 'dpl_1', name: 'e2e', blocking: 'true' },
        'create_check'
      )
    ).toMatchObject({ blocking: true })
    expect(
      toolCallParams({ apiKey: 'tok', deploymentId: 'dpl_1', name: 'e2e' }, 'create_check')
    ).toMatchObject({ blocking: false })
  })

  it('keeps the args the model supplied under the tool param names', () => {
    expect(
      toolCallParams(
        { apiKey: 'tok', deploymentId: 'dpl_1', name: 'e2e', blocking: true },
        'create_check'
      )
    ).toMatchObject({ deploymentId: 'dpl_1', name: 'e2e', blocking: true })
    expect(
      toolCallParams({ apiKey: 'tok', recordId: 'rec_1', name: 'api' }, 'update_dns_record')
    ).toMatchObject({ recordId: 'rec_1', name: 'api' })
  })

  it('maps block field names on a tool row written by Copilot or the API', () => {
    expect(
      toolCallParams(
        { apiKey: 'tok', recordId: 'rec_1', updateRecordName: 'www', updateSrvPort: '5060' },
        'update_dns_record'
      )
    ).toMatchObject({ recordId: 'rec_1', name: 'www', srvPort: 5060 })
  })
})
