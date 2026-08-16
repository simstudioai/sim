/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { v2ListBillingLogsContract } from '@/lib/api/contracts/v2/billing'
import { v2ListCredentialsContract } from '@/lib/api/contracts/v2/credentials'
import { v2ListCustomToolsContract } from '@/lib/api/contracts/v2/custom-tools'
import { v2ListKnowledgeBasesContract } from '@/lib/api/contracts/v2/knowledge'
import { v2ListSecretsContract } from '@/lib/api/contracts/v2/secrets'
import {
  V2_DEFAULT_PAGE_SIZE,
  V2_MAX_PAGE_SIZE,
  v2LimitSchema,
} from '@/lib/api/contracts/v2/shared'
import { v2ListSkillsContract } from '@/lib/api/contracts/v2/skills'
import { v2ListWorkflowsContract } from '@/lib/api/contracts/v2/workflows'
import { v2ListWorkspaceMembersContract } from '@/lib/api/contracts/v2/workspaces'

/**
 * `limit` is the one v2 query param whose value reaches SQL as a number rather
 * than a bound comparison, so a value that survives validation but is not a
 * whole number lands in `LIMIT`. `GET /api/v2/workflows` shipped without
 * `.int()` — copied from a sibling that had it — and `?limit=1.5` therefore
 * became `LIMIT 2.5`, a Postgres type error surfacing as 500. A caller-supplied
 * query value must never be able to produce a 500.
 */
describe('v2 limit validation', () => {
  const WORKSPACE = '00000000-0000-4000-8000-000000000000'

  function parseLimit(limit: string) {
    return v2ListWorkflowsContract.query?.safeParse({ workspaceId: WORKSPACE, limit })
  }

  it('rejects a fractional limit instead of passing it through to SQL', () => {
    for (const limit of ['1.5', '2.5', '3.7', '99.9']) {
      const parsed = parseLimit(limit)
      expect(parsed?.success, `limit=${limit} must not parse`).toBe(false)
      expect(parsed?.error?.issues[0]?.message).toBe('limit must be a whole number')
    }
  })

  it('still accepts an integral limit written with a decimal point', () => {
    const parsed = parseLimit('2.0')
    expect(parsed?.success).toBe(true)
    expect(parsed?.success && parsed.data.limit).toBe(2)
  })

  it('names the parameter for a non-finite limit rather than "expected number, received number"', () => {
    for (const limit of ['Infinity', '-Infinity', 'abc']) {
      const parsed = parseLimit(limit)
      expect(parsed?.success).toBe(false)
      expect(parsed?.error?.issues[0]?.message).toBe('limit must be a number')
    }
  })

  it('reports the bound it enforces', () => {
    expect(parseLimit('0')?.error?.issues[0]?.message).toBe('limit must be at least 1')
    expect(parseLimit('101')?.error?.issues[0]?.message).toBe(
      `limit cannot exceed ${V2_MAX_PAGE_SIZE}`
    )
  })

  /**
   * The five collections that gained pagination in this change, plus the three
   * that already had it. Every one must answer a fractional `limit` the same
   * way — the divergence is what let `/workflows` drift into a 500 while its
   * two same-file siblings stayed correct.
   */
  const PAGED_CONTRACTS = [
    ['workflows', v2ListWorkflowsContract, { workspaceId: WORKSPACE }],
    ['workspace members', v2ListWorkspaceMembersContract, {}],
    ['billing logs', v2ListBillingLogsContract, { workspaceId: WORKSPACE }],
    ['credentials', v2ListCredentialsContract, { workspaceId: WORKSPACE }],
    ['custom tools', v2ListCustomToolsContract, { workspaceId: WORKSPACE }],
    ['knowledge bases', v2ListKnowledgeBasesContract, { workspaceId: WORKSPACE }],
    ['secrets', v2ListSecretsContract, { workspaceId: WORKSPACE }],
    ['skills', v2ListSkillsContract, { workspaceId: WORKSPACE }],
  ] as const

  it.each(PAGED_CONTRACTS)('rejects a fractional limit on %s', (_name, contract, base) => {
    const parsed = contract.query?.safeParse({ ...base, limit: '1.5' })
    expect(parsed?.success).toBe(false)
    expect(parsed?.error?.issues[0]?.message).toBe('limit must be a whole number')
  })

  it.each(PAGED_CONTRACTS)('defaults %s to the shared page size', (_name, contract, base) => {
    const parsed = contract.query?.safeParse(base)
    expect(parsed?.success).toBe(true)
    expect(parsed?.success && parsed.data.limit).toBe(V2_DEFAULT_PAGE_SIZE)
  })

  /**
   * `/files`, `/logs`, and `/tables` shipped truncating and clamping instead,
   * and published that leniency in their OpenAPI description, so they keep it.
   * Pinning it here is what makes the difference deliberate rather than another
   * copy that lost its `.int()`.
   */
  describe('the clamping variant kept for already-shipped lenient lists', () => {
    const clamped = v2LimitSchema({ max: 1000, fallback: 100, outOfRange: 'clamp' })

    it('truncates a fractional limit rather than rejecting it', () => {
      expect(clamped.parse('1.5')).toBe(1)
      expect(clamped.parse('7.9')).toBe(7)
    })

    it('clamps out-of-range values into the accepted band', () => {
      expect(clamped.parse('0')).toBe(1)
      expect(clamped.parse('-5')).toBe(1)
      expect(clamped.parse('99999')).toBe(1000)
    })

    /**
     * The published schema must not carry `minimum`/`maximum`. In JSON Schema
     * they mean "rejected outside", so publishing them beside a description
     * that promises clamping made a generated SDK refuse locally a `limit` this
     * branch would have accepted and corrected. The rejecting branch keeps its
     * bounds, because there they are true.
     */
    it('publishes no numeric bounds, because it clamps rather than rejects', () => {
      const published = z.toJSONSchema(clamped, { io: 'input', unrepresentable: 'any' })
      expect(published).not.toHaveProperty('minimum')
      expect(published).not.toHaveProperty('maximum')
      expect(published.description).toContain('clamped')
    })

    it('keeps the bounds on the rejecting branch, where they are enforced', () => {
      const rejecting = v2LimitSchema({ max: 1000, fallback: 100 })
      const published = z.toJSONSchema(rejecting, { io: 'input', unrepresentable: 'any' })
      expect(published).toMatchObject({ minimum: 1, maximum: 1000 })
      expect(rejecting.safeParse('99999').success).toBe(false)
    })
  })
})
