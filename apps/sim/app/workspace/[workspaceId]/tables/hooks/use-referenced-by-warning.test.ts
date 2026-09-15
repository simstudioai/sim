/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/queries/tables', () => ({
  useTablesList: vi.fn(),
}))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useOptionalWorkspaceHostContext: vi.fn(),
}))

import { referencedByWarningText } from '@/app/workspace/[workspaceId]/tables/hooks/use-referenced-by-warning'

describe('referencedByWarningText', () => {
  it('adds nothing when no surviving table references the deletion', () => {
    expect(referencedByWarningText([])).toEqual([])
  })

  it('names a single referencing table', () => {
    expect(referencedByWarningText(['Orders'])).toEqual([
      ' Reference columns in Orders will point to a missing table.',
    ])
  })

  it('joins referencing tables as a readable list', () => {
    expect(referencedByWarningText(['Invoices', 'Orders'])).toEqual([
      ' Reference columns in Invoices and Orders will point to a missing table.',
    ])
  })

  it('lists the first three names and summarizes the rest', () => {
    expect(referencedByWarningText(['Accounts', 'Invoices', 'Leads', 'Orders', 'Quotes'])).toEqual([
      ' Reference columns in Accounts, Invoices, Leads, and 2 more will point to a missing table.',
    ])
  })
})
