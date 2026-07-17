/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { guardrailsValidateContract } from '@/lib/api/contracts/hotspots'
import { guardrailsValidateTool } from '@/tools/guardrails/validate'

// The block layer serializes an empty checkbox / table subBlock to `null`; the
// tool's body builder must produce a shape the contract accepts (undefined, not null).
const buildBody = (params: Record<string, unknown>) =>
  guardrailsValidateTool.request.body?.(params as never) as Record<string, unknown>

describe('guardrailsValidateTool.request.body', () => {
  it('coerces a null entity-type checkbox to omitted, and the contract accepts it', () => {
    const body = buildBody({ input: 'x', validationType: 'pii', piiEntityTypes: null })
    expect(body.piiEntityTypes).toBeUndefined()
    expect(guardrailsValidateContract.body.safeParse(body).success).toBe(true)
  })

  it('passes a real entity-type array through unchanged', () => {
    const body = buildBody({
      input: 'x',
      validationType: 'pii',
      piiEntityTypes: ['EMAIL_ADDRESS'],
    })
    expect(body.piiEntityTypes).toEqual(['EMAIL_ADDRESS'])
  })

  it('maps custom-pattern table rows to the wire shape and validates against the contract', () => {
    const body = buildBody({
      input: 'x',
      validationType: 'pii',
      piiEntityTypes: null,
      piiCustomPatterns: [
        { cells: { Name: 'Emp', Pattern: 'EMP-\\d{6}', Replacement: 'EMPLOYEE_ID' } },
      ],
    })
    expect(body.piiCustomPatterns).toEqual([
      { name: 'Emp', regex: 'EMP-\\d{6}', replacement: 'EMPLOYEE_ID' },
    ])
    expect(guardrailsValidateContract.body.safeParse(body).success).toBe(true)
  })

  it('omits custom patterns when the table is empty/null', () => {
    const body = buildBody({
      input: 'x',
      validationType: 'pii',
      piiEntityTypes: null,
      piiCustomPatterns: null,
    })
    expect(body.piiCustomPatterns).toBeUndefined()
  })

  it('regression guard: the contract rejects the raw null the block emits (why we coerce)', () => {
    const parsed = guardrailsValidateContract.body.safeParse({
      input: 'x',
      validationType: 'pii',
      piiEntityTypes: null,
    })
    expect(parsed.success).toBe(false)
  })
})
