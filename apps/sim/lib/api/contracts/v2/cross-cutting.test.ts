import { describe, expect, it } from 'vitest'
import { v2ListAuditLogsContract } from '@/lib/api/contracts/v2/audit-logs'
import { v2GetWorkflowRunContract } from '@/lib/api/contracts/v2/workflows'

/**
 * Two v2 boolean query params were spelled as a `'true'`/`'false'` string enum
 * while four others were real booleans. Normalising them onto the shared flag
 * must not change what an existing caller can send, so both spellings are
 * pinned rather than just the new one.
 */
describe('v2 boolean query params', () => {
  const cases = [
    ['includeOutput', v2GetWorkflowRunContract.query],
    ['includeDeparted', v2ListAuditLogsContract.query],
  ] as const

  it.each(cases)('%s accepts the string spellings unchanged', (field, schema) => {
    expect(schema).toBeDefined()
    const parseField = (value: string) => {
      const parsed = schema?.safeParse(
        field === 'includeDeparted'
          ? { organizationId: 'org-1', [field]: value }
          : { [field]: value }
      )
      expect(parsed?.success).toBe(true)
      return (parsed?.data as Record<string, unknown> | undefined)?.[field]
    }
    expect(parseField('true')).toBe(true)
    expect(parseField('false')).toBe(false)
  })

  it.each(cases)('%s accepts a real boolean and defaults to false', (field, schema) => {
    const withBoolean = schema?.safeParse(
      field === 'includeDeparted' ? { organizationId: 'org-1', [field]: true } : { [field]: true }
    )
    expect((withBoolean?.data as Record<string, unknown> | undefined)?.[field]).toBe(true)

    const omitted = schema?.safeParse(
      field === 'includeDeparted' ? { organizationId: 'org-1' } : {}
    )
    expect((omitted?.data as Record<string, unknown> | undefined)?.[field]).toBe(false)
  })
})
