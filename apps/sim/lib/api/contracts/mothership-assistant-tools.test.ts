/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  assistantToolContracts,
  listWorkspacesResultSchema,
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

  it('distinguishes complete target permissions from compact discovery restrictions', () => {
    const workspace = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Workspace',
      role: 'read',
    }
    const result = (detail: Record<string, unknown>) => ({
      success: true,
      workspaces: [{ ...workspace, ...detail }],
      nextCursor: null,
    })
    expect(
      listWorkspacesResultSchema.parse(
        result({ capabilityDetail: 'full', capabilities: { 'copilot.use': true } })
      ).workspaces[0]
    ).toMatchObject({ capabilityDetail: 'full', capabilities: { 'copilot.use': true } })
    expect(
      listWorkspacesResultSchema.parse(
        result({
          capabilityDetail: 'restrictions',
          copilotAllowed: true,
          deniedCapabilities: ['personal_api_key.use'],
        })
      ).workspaces[0]
    ).not.toHaveProperty('capabilities')
    expect(
      listWorkspacesResultSchema.safeParse(result({ capabilities: { 'copilot.use': true } }))
        .success
    ).toBe(false)
    expect(
      listWorkspacesResultSchema.safeParse(
        result({ capabilityDetail: 'full', copilotAllowed: true })
      ).success
    ).toBe(false)
  })

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
    expect(TOOL_CATALOG.search_workspace?.parameters).not.toHaveProperty('required')
    expect(searchWorkspaceInputSchema.parse({ startDate: '2026-09-22T00:00:00Z' })).toMatchObject({
      query: '',
      topK: 20,
    })
    expect(TOOL_CATALOG.read_document?.parameters).toMatchObject({ required: ['documentId'] })
  })
})
