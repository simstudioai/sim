/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  assistantToolContracts,
  readDocumentInputSchema,
  searchWorkspaceInputSchema,
} from '@/lib/api/contracts/mothership-assistant-tools'
import { TOOL_CATALOG } from '@/lib/mothership/generated/tool-catalog-v1'
import { TOOL_RUNTIME_SCHEMAS } from '@/lib/mothership/generated/tool-schemas-v1'

describe('Assistant execution contracts', () => {
  it.each(assistantToolContracts)(
    'generates the actual $id input schema and routing',
    (contract) => {
      const expected = z.toJSONSchema(contract.inputSchema, { target: 'draft-7', io: 'input' })
      expect(TOOL_CATALOG[contract.id]?.route).toBe(contract.route)
      expect(TOOL_CATALOG[contract.id]?.parameters).toEqual(expected)
      expect(TOOL_RUNTIME_SCHEMAS[contract.id]?.parameters).toEqual(expected)
    }
  )

  it('preserves retrieval defaults and normalization without requiring defaulted input fields', () => {
    expect(searchWorkspaceInputSchema.parse({ query: '  needle  ', source: '  slack  ' })).toEqual({
      query: 'needle',
      source: 'slack',
      topK: 20,
    })
    expect(readDocumentInputSchema.parse({ documentId: 'doc-1' })).toEqual({
      documentId: 'doc-1',
      limit: 3,
    })
    expect(TOOL_CATALOG.search_workspace?.parameters).toMatchObject({ required: ['query'] })
    expect(TOOL_CATALOG.read_document?.parameters).toMatchObject({ required: ['documentId'] })
  })
})
