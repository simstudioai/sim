/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  customPatternSchema,
  isCanonicalBase64,
  MAX_ID_LENGTH,
  optionalNumberQuerySchema,
  organizationIdSchema,
  organizationRoleSchema,
  piiStagePolicySchema,
  piiStagesSchema,
  privateSecretProvenanceBundleSchema,
  resolvedSecretTraceProvenanceSchema,
  withMissingFieldMessage,
  workflowIdSchema,
  workspaceFileIdSchema,
  workspaceFileNameSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'

describe('organizationRoleSchema', () => {
  it.each(['owner', 'admin', 'member'] as const)('accepts canonical role %s', (role) => {
    expect(organizationRoleSchema.parse(role)).toBe(role)
  })

  it.each(['billing-owner', 'viewer', '', null, undefined])('rejects invalid role %j', (role) => {
    expect(organizationRoleSchema.safeParse(role).success).toBe(false)
  })
})

describe('workspaceFileNameSchema', () => {
  it('trims and accepts one bounded file name', () => {
    expect(workspaceFileNameSchema.parse(' report.pdf ')).toBe('report.pdf')
    expect(workspaceFileNameSchema.safeParse('a'.repeat(255)).success).toBe(true)
  })

  it.each([undefined, '', '   ', '.', '..', 'folder/report.pdf', 'folder\\report.pdf'])(
    'rejects invalid file name %j',
    (name) => {
      expect(workspaceFileNameSchema.safeParse(name).success).toBe(false)
    }
  )

  it('rejects names longer than 255 characters', () => {
    expect(workspaceFileNameSchema.safeParse('a'.repeat(256)).success).toBe(false)
  })
})

describe('isCanonicalBase64', () => {
  it.each(['', 'TQ==', 'TWE=', 'TWFu', 'AAEC/w=='])('accepts canonical base64 %j', (value) => {
    expect(isCanonicalBase64(value)).toBe(true)
  })

  it.each(['TQ', 'TQ=', 'TQ===', 'T=Q=', 'TQ==\n', 'TR==', 'TWF='])(
    'rejects malformed or non-canonical base64 %j',
    (value) => {
      expect(isCanonicalBase64(value)).toBe(false)
    }
  )
})

describe('customPatternSchema', () => {
  it('accepts a well-formed pattern', () => {
    expect(
      customPatternSchema.parse({ name: 'Employee ID', regex: 'EMP-\\d{6}', replacement: '<EMP>' })
    ).toEqual({ name: 'Employee ID', regex: 'EMP-\\d{6}', replacement: '<EMP>' })
  })

  it('rejects an empty regex', () => {
    expect(customPatternSchema.safeParse({ name: 'x', regex: '', replacement: '' }).success).toBe(
      false
    )
  })

  it('rejects an over-long regex', () => {
    expect(
      customPatternSchema.safeParse({ name: '', regex: 'a'.repeat(513), replacement: '' }).success
    ).toBe(false)
  })

  it('rejects a syntactically invalid regex at the boundary (not just in the editor)', () => {
    const parsed = customPatternSchema.safeParse({ name: 'bad', regex: '(', replacement: '' })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0].path).toEqual(['regex'])
    }
  })

  it('no longer screens for catastrophic backtracking, which never worked here', () => {
    // This used to reject `(a+)+$` via `safe-regex2`. The screen was removed:
    // it caught that shape but passed `a*a*b`, which is just as catastrophic,
    // so it only ever deterred the obvious spelling of a misconfiguration a
    // user can inflict on their own workspace. It also rejected valid patterns
    // (lookbehind, optional groups) that Presidio accepts.
    //
    // These patterns run in Presidio, not in this process, so they cannot
    // stall this event loop; Presidio's own timeout is the bound. In-process
    // matching uses `compileLinearRegex`, which cannot backtrack at all.
    for (const regex of ['(a+)+$', 'a*a*b', '(?<=id: )\\w+']) {
      expect(
        customPatternSchema.safeParse({ name: 'p', regex, replacement: '' }).success,
        `pattern ${regex} should be accepted`
      ).toBe(true)
    }
  })
})

describe('piiStagePolicySchema', () => {
  it('allows an enabled stage with only custom patterns (no entity types)', () => {
    const parsed = piiStagePolicySchema.safeParse({
      enabled: true,
      entityTypes: [],
      customPatterns: [{ name: 'Ticket', regex: 'TCK-\\d+', replacement: '<TICKET>' }],
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects an enabled stage with no entity types and no custom patterns', () => {
    const parsed = piiStagePolicySchema.safeParse({ enabled: true, entityTypes: [] })
    expect(parsed.success).toBe(false)
  })
})

describe('piiStagesSchema', () => {
  it('keeps custom patterns on blockOutputs while stripping NER, staying enabled', () => {
    const parsed = piiStagesSchema.parse({
      input: { enabled: false, entityTypes: [] },
      blockOutputs: {
        enabled: true,
        entityTypes: ['PERSON', 'EMAIL_ADDRESS'],
        customPatterns: [{ name: 'Ticket', regex: 'TCK-\\d+', replacement: '<TICKET>' }],
      },
      logs: { enabled: false, entityTypes: [] },
    })
    expect(parsed.blockOutputs.entityTypes).toEqual(['EMAIL_ADDRESS'])
    expect(parsed.blockOutputs.customPatterns).toEqual([
      { name: 'Ticket', regex: 'TCK-\\d+', replacement: '<TICKET>' },
    ])
    expect(parsed.blockOutputs.enabled).toBe(true)
  })

  it('keeps blockOutputs enabled when only custom patterns survive the NER strip', () => {
    const parsed = piiStagesSchema.parse({
      input: { enabled: false, entityTypes: [] },
      blockOutputs: {
        enabled: true,
        entityTypes: ['PERSON'],
        customPatterns: [{ name: 'Ticket', regex: 'TCK-\\d+', replacement: '<TICKET>' }],
      },
      logs: { enabled: false, entityTypes: [] },
    })
    expect(parsed.blockOutputs.entityTypes).toEqual([])
    expect(parsed.blockOutputs.enabled).toBe(true)
  })
})

describe('resolvedSecretTraceProvenanceSchema', () => {
  it('accepts a complete bounded provenance envelope', () => {
    expect(
      resolvedSecretTraceProvenanceSchema.safeParse({
        version: 1,
        complete: true,
        entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
      }).success
    ).toBe(true)
  })

  it('rejects entries on an incomplete envelope', () => {
    expect(
      resolvedSecretTraceProvenanceSchema.safeParse({
        version: 1,
        complete: false,
        entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
      }).success
    ).toBe(false)
  })

  it('rejects an aggregate envelope larger than the provenance budget', () => {
    const encryptedValue = 'a'.repeat(4_300_000)
    expect(
      resolvedSecretTraceProvenanceSchema.safeParse({
        version: 1,
        complete: true,
        entries: [{ encryptedValue }, { encryptedValue }],
      }).success
    ).toBe(false)
  })
})

describe('privateSecretProvenanceBundleSchema', () => {
  const selection = {
    key: '[0,"column-1"]',
    provenance: {
      version: 1 as const,
      complete: true,
      entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
    },
  }

  it('accepts a complete bundle with unique, valid selections', () => {
    expect(
      privateSecretProvenanceBundleSchema.safeParse({
        version: 1,
        complete: true,
        selections: [selection],
      }).success
    ).toBe(true)
  })

  it('rejects selections on an incomplete bundle', () => {
    expect(
      privateSecretProvenanceBundleSchema.safeParse({
        version: 1,
        complete: false,
        selections: [selection],
      }).success
    ).toBe(false)
  })

  it('rejects duplicate selection keys', () => {
    expect(
      privateSecretProvenanceBundleSchema.safeParse({
        version: 1,
        complete: true,
        selections: [selection, selection],
      }).success
    ).toBe(false)
  })
})

/**
 * `.min(1)` only fires for a present-but-empty string, so without the
 * `z.string({ error })` form an omitted field falls back to Zod's default
 * "expected string, received undefined" — which does not name the field the
 * caller left out. These are the shared id schemas every contract builds on, so
 * the wording here is the first thing an API consumer sees on a malformed
 * request.
 */
describe('shared id schemas name the field when it is missing', () => {
  const cases = [
    ['workspaceIdSchema', workspaceIdSchema, 'Workspace ID is required'],
    ['organizationIdSchema', organizationIdSchema, 'Organization ID is required'],
    ['workflowIdSchema', workflowIdSchema, 'Workflow ID is required'],
    ['workspaceFileIdSchema', workspaceFileIdSchema, 'File ID is required'],
  ] as const

  for (const [name, schema, message] of cases) {
    it(`${name}: omitted value reports "${message}"`, () => {
      const result = schema.safeParse(undefined)

      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toBe(message)
    })

    it(`${name}: empty string reports "${message}"`, () => {
      const result = schema.safeParse('')

      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toBe(message)
    })

    it(`${name}: a valid id still passes`, () => {
      expect(schema.safeParse('abc-123').success).toBe(true)
    })
  }

  it('does not leak Zod default wording for a missing field', () => {
    const result = workspaceIdSchema.safeParse(undefined)

    expect(result.error?.issues[0]?.message).not.toContain('received undefined')
  })

  /**
   * A schema-level `error` string replaces the message for *every* issue, so the
   * required-field wording used to answer a wrong-typed value too: `{"name": 123}`
   * came back "Name is required" when a name had in fact been supplied. Missing and
   * wrong-typed are different mistakes and must read differently.
   */
  for (const [name, schema, message] of cases) {
    it(`${name}: a wrong-typed value reports the type, not "${message}"`, () => {
      const result = schema.safeParse(123)

      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toBe(
        'Invalid input: expected string, received number'
      )
    })
  }

  it('workspaceFileNameSchema separates a missing name from a wrong-typed one', () => {
    expect(workspaceFileNameSchema.safeParse(undefined).error?.issues[0]?.message).toBe(
      'Name is required'
    )
    expect(workspaceFileNameSchema.safeParse(123).error?.issues[0]?.message).toBe(
      'Invalid input: expected string, received number'
    )
  })
})

/**
 * An unbounded `workspaceId` reached the workspace lookup at whatever length the
 * caller chose. No workspace id this repo mints approaches the bound, so it only
 * rejects values that could never have resolved.
 */
describe('workspaceIdSchema length bound', () => {
  it('accepts an id at the bound', () => {
    expect(workspaceIdSchema.safeParse('a'.repeat(MAX_ID_LENGTH)).success).toBe(true)
  })

  it('rejects an id one character past the bound, naming the field', () => {
    const result = workspaceIdSchema.safeParse('a'.repeat(MAX_ID_LENGTH + 1))

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('Workspace ID is too long')
  })

  it('still accepts a UUID workspace id', () => {
    expect(workspaceIdSchema.safeParse('7a6cce2b-78b8-40bc-b8d3-0a2a6dfd9023').success).toBe(true)
  })
})

describe('withMissingFieldMessage', () => {
  const base = z.string().min(1, 'Description is required').max(8, 'Description is too long')
  const retrofitted = withMissingFieldMessage(base, 'Description is required')

  it('names the field when the value is omitted', () => {
    expect(retrofitted.safeParse(undefined).error?.issues[0]?.message).toBe(
      'Description is required'
    )
  })

  it('keeps Zod default wording for a wrong-typed value', () => {
    expect(retrofitted.safeParse(5).error?.issues[0]?.message).toBe(
      'Invalid input: expected string, received number'
    )
  })

  it('preserves the checks the source schema carried', () => {
    expect(retrofitted.safeParse('').error?.issues[0]?.message).toBe('Description is required')
    expect(retrofitted.safeParse('a'.repeat(9)).error?.issues[0]?.message).toBe(
      'Description is too long'
    )
    expect(retrofitted.safeParse('ok').success).toBe(true)
  })
})

describe('optionalNumberQuerySchema', () => {
  it('keeps a real numeric bound, including an explicit zero', () => {
    expect(optionalNumberQuerySchema.parse('0')).toBe(0)
    expect(optionalNumberQuerySchema.parse('2.5')).toBe(2.5)
    expect(optionalNumberQuerySchema.parse(7)).toBe(7)
  })

  it('drops an omitted or present-but-empty value', () => {
    expect(optionalNumberQuerySchema.parse(undefined)).toBeUndefined()
    expect(optionalNumberQuerySchema.parse('')).toBeUndefined()
    expect(optionalNumberQuerySchema.parse('   ')).toBeUndefined()
  })

  /**
   * `z.coerce.number()` reads `null` as `0`, which would turn a client that
   * spells an unset bound as `null` into a caller asking a cost question.
   */
  it('drops null rather than coercing it to a zero bound', () => {
    expect(optionalNumberQuerySchema.parse(null)).toBeUndefined()
  })

  it('still rejects a non-numeric value', () => {
    expect(optionalNumberQuerySchema.safeParse('abc').success).toBe(false)
  })
})
