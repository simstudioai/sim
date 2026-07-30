/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  apiReferenceEntrySchema,
  publicationSettingsSchema,
} from '@/lib/api/contracts/api-reference'
import type { ApiReferenceEntry } from '@/lib/workflows/api-reference/types'

/**
 * Guards against drift between the domain type (`ApiReferenceEntry`) the derivation
 * layer produces and the wire contract (`apiReferenceEntrySchema`) routes validate
 * against. If the two diverge, this literal stops type-checking or fails to parse.
 */
const SAMPLE_ENTRY: ApiReferenceEntry = {
  workflowId: 'wf-1',
  name: 'Ask Biz',
  summary: 'Answers business questions',
  description: null,
  version: 3,
  deployedAt: '2026-01-01T00:00:00.000Z',
  invokeUrl: 'https://sim.example/api/workflows/wf-1/execute',
  auth: { type: 'api_key', header: 'x-api-key', description: 'Send a key' },
  input: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  output: { type: 'object', properties: { answer: { type: 'string' } } },
  exposure: { trace: 'traceId', blocks: false },
  versions: [
    { version: 3, deployedAt: '2026-01-01T00:00:00.000Z', breaking: true, changes: ['x'] },
  ],
}

describe('api-reference contract', () => {
  it('accepts an entry shaped exactly like the derivation output', () => {
    expect(() => apiReferenceEntrySchema.parse(SAMPLE_ENTRY)).not.toThrow()
  })

  it('publication settings default-safe values round-trip', () => {
    const parsed = publicationSettingsSchema.parse({
      published: false,
      displayName: null,
      summary: null,
      description: null,
      fieldOverlay: null,
      exposeTrace: 'off',
      exposeBlocks: false,
      visibility: 'org',
      allowlistWorkspaceIds: null,
    })
    expect(parsed.published).toBe(false)
    expect(parsed.exposeTrace).toBe('off')
  })

  it('rejects an invalid exposeTrace value', () => {
    expect(() =>
      publicationSettingsSchema.parse({
        published: true,
        displayName: null,
        summary: null,
        description: null,
        fieldOverlay: null,
        exposeTrace: 'everything',
        exposeBlocks: false,
        visibility: 'org',
        allowlistWorkspaceIds: null,
      })
    ).toThrow()
  })
})
