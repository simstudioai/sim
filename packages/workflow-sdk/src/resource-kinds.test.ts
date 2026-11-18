/**
 * `core.d.ts` stands alone (users' editors read it without the monorepo), so it spells each
 * resource kind as a literal in `ResourceRef<'kind'>`. Each must be a kind the compiler resolves
 * (`PortableResourceKind`): a misspelled one types a reference the compiler never reads.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { WORKFLOW_RESOURCE_KINDS } from '@sim/workflow-types/resources'
import { describe, expect, it } from 'vitest'

const CORE = readFileSync(path.resolve(import.meta.dirname, 'core.d.ts'), 'utf8')

describe('core.d.ts resource kinds', () => {
  it('names only portable resource kinds', () => {
    const kinds = [...CORE.matchAll(/ResourceRef<'([^']+)'/g)].map((match) => match[1])
    const portable: readonly string[] = [...WORKFLOW_RESOURCE_KINDS, 'workflow']

    expect(kinds.length).toBeGreaterThan(0)
    expect(kinds.filter((kind) => !portable.includes(kind))).toEqual([])
  })
})
