/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { v2UpdateKnowledgeDocumentBodySchema } from '@/lib/api/contracts/v2/knowledge'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'

describe('v2 document update tag slots', () => {
  it('accepts every slot GET /knowledge/{knowledgeBaseId}/tags can advertise', () => {
    for (const [field, value] of [
      ['tag1', 'billing'],
      ['number1', 7],
      ['number5', -1.5],
      ['date1', '2026-08-06'],
      ['boolean3', true],
    ] as const) {
      const result = v2UpdateKnowledgeDocumentBodySchema.safeParse({
        workspaceId: WORKSPACE_ID,
        [field]: value,
      })
      expect(result.success, `${field} was rejected`).toBe(true)
    }
  })

  it('rejects a malformed typed slot rather than silently clearing the tag', () => {
    for (const [field, value] of [
      ['number1', 'abc'],
      ['date1', '2026-02-31'],
      ['date2', '06-08-2026'],
      ['boolean1', 'yes'],
    ] as const) {
      const result = v2UpdateKnowledgeDocumentBodySchema.safeParse({
        workspaceId: WORKSPACE_ID,
        [field]: value,
      })
      expect(result.success, `${field} was accepted`).toBe(false)
    }
  })
})
