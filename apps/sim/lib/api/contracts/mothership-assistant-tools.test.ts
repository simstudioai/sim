import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  assistantToolContracts,
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

  it('counts an account-wide native query against the busiest targeted account', () => {
    const accepts = (nativeQueries: Record<string, string>[]) =>
      searchWorkspaceInputSchema.safeParse({ query: 'launch', nativeQueries }).success
    const on = (accountId: string, query: string) => ({ provider: 'slack', accountId, query })
    const everywhere = { provider: 'slack', query: 'everywhere' }
    expect(accepts([on('a', '1'), on('b', '2'), on('c', '3'), on('d', '4'), everywhere])).toBe(true)
    expect(
      accepts([on('a', '1'), on('a', '2'), on('a', '3'), on('b', '4'), on('b', '5'), everywhere])
    ).toBe(true)
    expect(accepts([on('a', '1'), on('a', '2'), on('a', '3'), on('a', '4'), everywhere])).toBe(
      false
    )
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
