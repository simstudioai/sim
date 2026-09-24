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
    const nativeQueries = [{ provider: 'github', query: 'author:@me', kind: 'commits' }]
    expect(searchWorkspaceInputSchema.parse({ nativeQueries })).toMatchObject({ query: '' })
    expect(searchWorkspaceInputSchema.safeParse({}).success).toBe(false)
  })

  it('accepts up to four distinct native queries per provider account', () => {
    const accepts = (nativeQueries: Record<string, string>[]) =>
      searchWorkspaceInputSchema.safeParse({ query: 'launch', nativeQueries }).success
    const slack = { provider: 'slack', accountId: 'account' }
    const alternatives = ['trip', 'travel', 'visiting', 'vacation', 'holiday'].map((query) => ({
      ...slack,
      query,
    }))
    expect(accepts(alternatives.slice(0, 4))).toBe(true)
    expect(accepts(alternatives)).toBe(false)
    expect(
      accepts([...alternatives.slice(0, 4), { ...alternatives[4]!, accountId: 'other' }])
    ).toBe(true)
  })

  it('rejects a native query that repeats a search on the same account', () => {
    const accepts = (nativeQueries: Record<string, string>[]) =>
      searchWorkspaceInputSchema.safeParse({ query: 'launch', nativeQueries }).success
    const trip = { provider: 'slack', accountId: 'account', query: 'trip' }
    expect(accepts([trip, trip])).toBe(false)
    expect(accepts([trip, { provider: 'slack', query: 'trip' }])).toBe(false)
    expect(accepts([trip, { ...trip, kind: 'issues' }])).toBe(false)
    expect(accepts([trip, { ...trip, accountId: 'other' }])).toBe(true)
  })

  it('takes one GitHub or GitLab query per account and kind', () => {
    const accepts = (nativeQueries: Record<string, string>[]) =>
      searchWorkspaceInputSchema.safeParse({ query: 'launch', nativeQueries }).success
    const github = { provider: 'github', accountId: 'account', query: 'repo:org/repo launch' }
    const kinds = ['issues', 'commits', 'code', 'repositories'].map((kind) => ({ ...github, kind }))
    expect(accepts(kinds)).toBe(true)
    expect(accepts([kinds[0]!, { ...kinds[0]!, query: 'repo:org/repo deploy' }])).toBe(false)
    expect(accepts([kinds[0]!, github])).toBe(false)
    expect(
      searchWorkspaceInputSchema.safeParse({ nativeQueries: [{ provider: 'github', query: '' }] })
        .success
    ).toBe(false)
  })
})
