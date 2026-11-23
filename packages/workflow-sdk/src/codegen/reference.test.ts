import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BlockCatalog } from '@sim/workflow-code'
import { catalogBuilderPaths } from '@sim/workflow-code/catalog/view'
import { describe, expect, it } from 'vitest'
import { builderSnippet, describeBuilder } from './reference'

/** A real catalog projected from registry blocks, shared with the SDK's own type checks. */
const CATALOG = JSON.parse(
  readFileSync(join(__dirname, '../../test/fixtures/catalog.json'), 'utf8')
) as BlockCatalog

describe('builder reference', () => {
  it('gives each special builder the call core.d.ts declares, with its own params and return type', () => {
    expect(describeBuilder(CATALOG, 'condition')?.signature).toBe(
      "condition<const B extends Record<string, BranchExpression>>(name: string, branches: B & ConditionBranches<B>, meta?: BlockMeta): Block<SpecialOutput<'condition'>> & Branches<ConditionKeys<B>>"
    )
    expect(describeBuilder(CATALOG, 'note')?.signature).toBe(
      "note(name: string, params: SpecialParams<'note'>, meta?: BlockMeta): Annotation"
    )
    expect(describeBuilder(CATALOG, 'response')?.signature.split('\n')).toEqual([
      "response(name: string, params: ResponseBody, meta?: BlockMeta): Block<SpecialOutput<'response'>>",
      "response(name: string, params: SpecialParams<'response'>, meta?: BlockMeta): Block<SpecialOutput<'response'>>",
    ])
  })

  it('carries what core.d.ts says of a builder it declares, and nothing for a generated one', () => {
    expect(describeBuilder(CATALOG, 'runWorkflow')?.doc).toContain('`result.data.field`')
    expect(describeBuilder(CATALOG, 'response')?.doc).toContain("`dataMode: 'json'` with `data`")
    expect(describeBuilder(CATALOG, 'agent')).not.toHaveProperty('doc')
  })

  it('fills a text, number or boolean param of a snippet with an example value, not its type', () => {
    const snippets = catalogBuilderPaths(CATALOG).flatMap((key) => {
      const reference = describeBuilder(CATALOG, key)
      return reference ? [builderSnippet(reference)] : []
    })
    expect(snippets.join('\n')).toContain("'…'")
    for (const snippet of snippets) {
      expect(snippet).not.toContain('<Value<')
    }
  })
})
