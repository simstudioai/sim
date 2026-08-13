/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  netsuiteObjectsBodySchema,
  netsuiteObjectsSelectorContract,
} from '@/lib/api/contracts/selectors/netsuite'

describe('NetSuite selector contract', () => {
  it('accepts only the three bounded selector request shapes', () => {
    expect(
      netsuiteObjectsBodySchema.parse({
        credential: ' cred-1 ',
        workflowId: ' wf-1 ',
        kind: 'record_types',
      })
    ).toEqual({ credential: 'cred-1', workflowId: 'wf-1', kind: 'record_types' })

    expect(
      netsuiteObjectsBodySchema.parse({
        credential: 'cred-1',
        workflowId: 'wf-1',
        kind: 'async_tasks',
        jobId: ' job-1 ',
      })
    ).toEqual({
      credential: 'cred-1',
      workflowId: 'wf-1',
      kind: 'async_tasks',
      jobId: 'job-1',
    })
  })

  it('requires a job only for asynchronous tasks and rejects extra scope fields', () => {
    expect(() =>
      netsuiteObjectsBodySchema.parse({
        credential: 'cred-1',
        workflowId: 'wf-1',
        kind: 'async_tasks',
      })
    ).toThrow(/Job ID is required/)
    expect(() =>
      netsuiteObjectsBodySchema.parse({
        credential: 'cred-1',
        workflowId: 'wf-1',
        kind: 'datasets',
        jobId: 'job-1',
      })
    ).toThrow()
  })

  it('bounds every caller-controlled identifier', () => {
    const common = { workflowId: 'wf-1', kind: 'record_types' as const }
    expect(() =>
      netsuiteObjectsBodySchema.parse({ ...common, credential: 'x'.repeat(129) })
    ).toThrow(/too long/)
    expect(() =>
      netsuiteObjectsBodySchema.parse({
        credential: 'cred-1',
        workflowId: 'x'.repeat(129),
        kind: 'record_types',
      })
    ).toThrow(/too long/)
    expect(() =>
      netsuiteObjectsBodySchema.parse({
        credential: 'cred-1',
        workflowId: 'wf-1',
        kind: 'async_tasks',
        jobId: 'x'.repeat(513),
      })
    ).toThrow(/too long/)
  })

  it('declares the normalized selector response and central route path', () => {
    expect(netsuiteObjectsSelectorContract.path).toBe('/api/tools/netsuite/objects')
    expect(
      netsuiteObjectsSelectorContract.response.schema.parse({
        objects: [{ id: 'customer', label: 'Customer', detail: null }],
      })
    ).toEqual({ objects: [{ id: 'customer', label: 'Customer', detail: null }] })
    expect(() =>
      netsuiteObjectsSelectorContract.response.schema.parse({
        objects: [{ id: 'customer', label: 'Customer' }],
      })
    ).toThrow()
  })
})
