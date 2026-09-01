/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { guardrailsValidationInputSchema } from '@/lib/internal/guardrails/input'
import { guardrailsValidateTool } from '@/tools/guardrails/validate'

// The block layer serializes an empty checkbox / table subBlock to `null`; the
// tool's body builder must produce a shape the contract accepts (undefined, not null).
const buildBody = (params: Record<string, unknown>) =>
  guardrailsValidateTool.operation.input(params as never) as Record<string, unknown>

describe('guardrailsValidateTool.operation.input', () => {
  it('coerces a null entity-type checkbox to omitted, and the contract accepts it', () => {
    const body = buildBody({ input: 'x', validationType: 'pii', piiEntityTypes: null })
    expect(body.piiEntityTypes).toBeUndefined()
    expect(guardrailsValidationInputSchema.safeParse(body).success).toBe(true)
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
    expect(guardrailsValidationInputSchema.safeParse(body).success).toBe(true)
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
    const parsed = guardrailsValidationInputSchema.safeParse({
      input: 'x',
      validationType: 'pii',
      piiEntityTypes: null,
    })
    expect(parsed.success).toBe(false)
  })

  it('does not materialize untrusted execution scope or HTTP metadata', () => {
    const body = buildBody({
      input: 'claim',
      validationType: 'hallucination',
      _context: { workflowId: 'untrusted-workflow', workspaceId: 'untrusted-workspace' },
    })
    expect(body).not.toHaveProperty('workflowId')
    expect(body).not.toHaveProperty('workspaceId')
    expect(guardrailsValidateTool).not.toHaveProperty('request')
  })
})

describe('guardrailsValidateTool.operation.modelInput', () => {
  it('delegates only hallucination input provenance to the authenticated operation', () => {
    const modelInput = guardrailsValidateTool.operation.modelInput
    expect(modelInput?.mode).toBe('private-provenance')
    if (modelInput?.mode !== 'private-provenance') throw new Error('Unexpected model input mode')

    expect(modelInput.inputPaths({ input: 'claim', validationType: 'hallucination' })).toEqual([
      ['input'],
    ])
    expect(modelInput.inputPaths({ input: 'private text', validationType: 'pii' })).toEqual([])
  })
})
