import { describe, expect, it } from 'vitest'
import { computeActionSchemaHash, stableStringify } from '@/lib/apps/manifest'

describe('stableStringify / computeActionSchemaHash', () => {
  it('is invariant to object key order', () => {
    const a = { type: 'object', properties: { q: { type: 'string' } }, additionalProperties: false }
    const b = { additionalProperties: false, properties: { q: { type: 'string' } }, type: 'object' }
    expect(stableStringify(a)).toBe(stableStringify(b))

    const hashA = computeActionSchemaHash({
      actionId: 'main',
      workflowId: 'wf',
      deploymentVersionId: 'dv',
      inputSchema: a,
      outputAllowlist: [],
      executionPolicy: 'sync',
    })
    const hashB = computeActionSchemaHash({
      actionId: 'main',
      workflowId: 'wf',
      deploymentVersionId: 'dv',
      inputSchema: b,
      outputAllowlist: [],
      executionPolicy: 'sync',
    })
    expect(hashA).toBe(hashB)
  })
})
