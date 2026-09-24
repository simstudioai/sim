import { describe, expect, it } from 'vitest'
import {
  BARREL_ENTRY_FILES,
  findBoundaryViolations,
  findStaleEntries,
  GATE_SPECIFIER,
  RETRIEVAL_BARREL,
  USE_CASE_BARREL,
} from './check-indexed-org-search-boundary'

const ENTRY = 'apps/sim/lib/knowledge/mcp/server.ts'
const RETRIEVAL_ENTRY = 'apps/sim/lib/knowledge/search/queries.ts'
const GATE_IMPORT = `import { isIndexedOrgSearchEnabled } from '${GATE_SPECIFIER}'`
const GATED = `${GATE_IMPORT}\nif (!isIndexedOrgSearchEnabled()) throw new Error('dormant')`

describe('indexed organization search boundary audit', () => {
  it('lets any file read the gate', () => {
    expect(
      findBoundaryViolations([
        { file: 'apps/sim/lib/knowledge/connectors/indexing-policy.ts', source: GATE_IMPORT },
      ])
    ).toEqual([])
  })

  it('lets an allowlisted entry import its barrel beside the gate', () => {
    expect(
      findBoundaryViolations([
        {
          file: ENTRY,
          source: `import { readIndexedKnowledgeDocument } from '${USE_CASE_BARREL}'\n${GATED}`,
        },
        {
          file: RETRIEVAL_ENTRY,
          source: `import { isProjectionFilled } from '${RETRIEVAL_BARREL}'\n${GATED}`,
        },
      ])
    ).toEqual([])
  })

  it('rejects a barrel import from a file that is not allowlisted', () => {
    expect(
      findBoundaryViolations([
        {
          file: 'apps/sim/lib/knowledge/application/chat.ts',
          source: `import { searchScopedKnowledge } from '${USE_CASE_BARREL}'\n${GATE_IMPORT}`,
        },
      ])
    ).toEqual([
      expect.objectContaining({
        file: 'apps/sim/lib/knowledge/application/chat.ts',
        line: 1,
        reason: `is not an allowlisted entry point for ${USE_CASE_BARREL}`,
      }),
    ])
  })

  it('rejects an entry importing the barrel it is not allowlisted for', () => {
    expect(
      findBoundaryViolations([
        {
          file: ENTRY,
          source: `import { isProjectionFilled } from '${RETRIEVAL_BARREL}'\n${GATED}`,
        },
      ])
    ).toEqual([expect.objectContaining({ file: ENTRY, specifier: RETRIEVAL_BARREL })])
  })

  it('rejects deep imports, re-exports, dynamic imports, and relative paths into the directory', () => {
    const violations = findBoundaryViolations([
      {
        file: ENTRY,
        source: [
          GATE_IMPORT,
          "import { readSearchDocument } from '@/lib/sim-search/indexed/documents/read-search-document'",
          "export { resolveTinKeywordQuery } from '@/lib/sim-search/indexed/retrieval/tin-keyword'",
          "const scoped = await import('@/lib/sim-search/indexed/search/scoped-search')",
        ].join('\n'),
      },
      {
        file: 'apps/sim/lib/sim-search/connectors.ts',
        source: "import { searchScopedKnowledge } from './indexed/search/scoped-search'",
      },
    ])
    expect(violations.map(({ file, line }) => `${file}:${line}`)).toEqual([
      `${ENTRY}:2`,
      `${ENTRY}:3`,
      `${ENTRY}:4`,
      'apps/sim/lib/sim-search/connectors.ts:1',
    ])
  })

  it.each([
    ['without the gate', `import { readIndexedKnowledgeDocument } from '${USE_CASE_BARREL}'`],
    [
      'importing the gate but never calling it',
      `import { readIndexedKnowledgeDocument } from '${USE_CASE_BARREL}'\n${GATE_IMPORT}`,
    ],
  ])('rejects an entry reaching in %s', (_case, source) => {
    expect(findBoundaryViolations([{ file: ENTRY, source }])).toEqual([
      expect.objectContaining({
        file: ENTRY,
        reason: 'reaches dormant indexed search without calling isIndexedOrgSearchEnabled()',
      }),
    ])
  })

  it('catches a dynamic import whose target is held in a variable', () => {
    expect(
      findBoundaryViolations([
        {
          file: 'apps/sim/lib/other/loader.ts',
          source: `const target = '${USE_CASE_BARREL}'\nexport const load = () => import(target)`,
        },
      ])
    ).toEqual([
      expect.objectContaining({
        file: 'apps/sim/lib/other/loader.ts',
        specifier: USE_CASE_BARREL,
        reason: `is not an allowlisted entry point for ${USE_CASE_BARREL}`,
      }),
    ])
  })

  it('accepts a gate called under an aliased import', () => {
    expect(
      findBoundaryViolations([
        {
          file: ENTRY,
          source: `import { readIndexedKnowledgeDocument } from '${USE_CASE_BARREL}'\nimport { isIndexedOrgSearchEnabled as indexedOn } from '${GATE_SPECIFIER}'\nexport const on = indexedOn()`,
        },
      ])
    ).toEqual([])
  })

  it('ignores tests, the dormant directory itself, and text that only names the module', () => {
    expect(
      findBoundaryViolations([
        {
          file: 'apps/sim/lib/knowledge/search/queries.test.ts',
          source: "import { x } from '@/lib/sim-search/indexed/retrieval/tin-keyword'",
        },
        {
          file: 'apps/sim/lib/sim-search/indexed/index.ts',
          source: "export { x } from '@/lib/sim-search/indexed/search/scoped-search'",
        },
        {
          file: 'apps/sim/lib/sim-search/live/application.ts',
          source:
            "/** See '@/lib/sim-search/indexed/search/scoped-search'. */\nconst a = 'indexed'",
        },
      ])
    ).toEqual([])
  })

  it('reports allowlisted entries that no longer import their barrel', () => {
    const importing = Object.entries(BARREL_ENTRY_FILES).flatMap(([barrel, entries]) =>
      Object.keys(entries).map((file) => ({ file, source: `import { x } from '${barrel}'` }))
    )
    expect(findStaleEntries(importing)).toEqual([])
    expect(
      findStaleEntries(
        importing.map((entry) => (entry.file === ENTRY ? { file: ENTRY, source: '' } : entry))
      )
    ).toEqual([`${ENTRY} (${USE_CASE_BARREL})`])
  })
})
