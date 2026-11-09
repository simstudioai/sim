import { describe, expect, it } from 'vitest'
import {
  type ComposerOption,
  filterOptions,
} from '@/app/(product)/_components/composer/reference-options'

const option = (group: string, name: string, extra: Partial<ComposerOption> = {}) =>
  ({ id: name, name, group, icon: 'I015', ...extra }) satisfies ComposerOption

describe('filterOptions', () => {
  it('keeps a server match whose name lacks the query, but not one for an older query', () => {
    const byPath = option('Files', 'q3.pdf', { matchedQuery: 'reports q3' })
    const stale = option('Files', 'notes.md', { matchedQuery: 'reports' })
    expect(filterOptions([byPath, stale], '@', 'Reports Q3')).toEqual([byPath])
  })

  it('reaches rows named after their workflow by their family name', () => {
    const run = option('Logs', 'Nightly sync · Nov 9, 2026, 3:42 PM', { family: 'Logs' })
    const table = option('Tables', 'Leads')
    expect(filterOptions([run, table], '@', 'logs')).toEqual([run])
  })
})
