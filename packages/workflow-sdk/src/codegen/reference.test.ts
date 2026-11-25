import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BlockCatalog } from '@sim/workflow-code'
import { catalogBuilderPaths } from '@sim/workflow-code/catalog/view'
import { describe, expect, it } from 'vitest'
import { CORE_DTS } from './core-text.generated'
import { builderSnippet, describeBuilder, lookupBuilder } from './reference'

/** A real catalog projected from registry blocks, shared with the SDK's own type checks. */
const CATALOG = JSON.parse(
  readFileSync(join(__dirname, '../../test/fixtures/catalog.json'), 'utf8')
) as BlockCatalog

describe('builder reference', () => {
  it('says table.upsertRow replaces the row, and names update builders that exist', () => {
    const upsert = describeBuilder(CATALOG, 'table.upsertRow')
    expect(upsert?.doc).toContain('Replaces the matched row')
    for (const [, name] of upsert?.doc?.matchAll(/`(table\.\w+)`/g) ?? []) {
      expect(describeBuilder(CATALOG, name), name).not.toBeNull()
    }
  })

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

  it("takes a special builder's example call from the @example line of its core.d.ts doc", () => {
    const condition = describeBuilder(CATALOG, 'condition')
    const example = /^ \* @example (condition\(.+)$/m.exec(CORE_DTS)?.[1]
    expect(example).toBeDefined()
    expect(condition?.example).toBe(example)
    expect(condition?.doc).not.toContain('@example')
    if (!condition || !example) throw new Error('no condition example')
    expect(builderSnippet(condition)).toContain(`\`\` const x = ${example} \`\``)
    expect(describeBuilder(CATALOG, 'agent')).not.toHaveProperty('example')
    const loop = lookupBuilder(CATALOG, 'loop')
    expect(loop.kind === 'core' && loop.declaration).toMatch(
      /@example const each = loop\.forEach\(/
    )
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

describe('lookupBuilder for a name the SDK spells differently', () => {
  const hint = (query: string) => {
    const found = lookupBuilder(CATALOG, query)
    return found.kind === 'missing' ? found.hint : found.kind
  }

  it('names the builder written for a block type in another spelling', () => {
    for (const query of ['humanInTheLoop', 'human_in_the_loop', 'Human-In-The-Loop']) {
      expect(hint(query), query).toBe('Did you mean human?')
    }
    expect(lookupBuilder(CATALOG, 'human_in_the_loop_v2').kind).toBe('builder')
  })

  it('names a builder path written in another case or with other separators', () => {
    expect(hint('table_upsert_row')).toBe('Did you mean table.upsertRow?')
    expect(hint('Table.UpsertRow')).toBe('Did you mean table.upsertRow?')
  })

  it('still reports nothing for a name that is neither', () => {
    expect(hint('humanOutOfTheLoop')).not.toBe('Did you mean human?')
  })
})
