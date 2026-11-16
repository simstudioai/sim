import { describe, expect, it } from 'vitest'
import { NetSuiteBlock } from '@/blocks/blocks/netsuite'

const blockParams = NetSuiteBlock.tools.config?.params
if (!blockParams) throw new Error('NetSuiteBlock has no params mapper')

describe('NetSuiteBlock', () => {
  it('parses a JSON body on an agent tool call, whose operation arrives only in context', () => {
    const args = { recordType: 'customer', body: '{"companyName":"Acme"}' }
    const result = {
      ...args,
      ...blockParams(args, { operation: 'netsuite_create_record' }),
    }

    expect(result.body).toEqual({ companyName: 'Acme' })
  })

  it('keeps the model task ID on an agent async status call', () => {
    const args = { jobId: '42', view: 'task', taskId: '7' }
    const result = {
      ...args,
      ...blockParams(args, { operation: 'netsuite_get_async_status' }),
    }

    expect(result.taskId).toBe('7')
  })
})
