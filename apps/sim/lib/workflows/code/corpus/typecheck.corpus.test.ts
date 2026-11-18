/**
 * Printed source type-checks against the SDK generated from the same catalog: what the printer
 * writes is source an author could have written, so the types never reject a read-back.
 *
 * Every corpus subject is printed and checked in one `tsc` run: the reduced corpus by default,
 * every workflow with `ROUNDTRIP_CORPUS_FULL=1`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { canonicalize, printWorkflow } from '@sim/workflow-code'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')
vi.unmock('@/tools/metadata-outputs')
vi.unmock('@/tools/registry')

import { registryCatalog as catalog } from '@/lib/workflows/code/catalog/registry-catalog.test-helpers'
import {
  CORPUS_RESOURCES,
  corpusBudgetMs,
  corpusSubjects,
} from '@/lib/workflows/code/corpus/fixtures.test-helpers'
import { typeCheckAgainstSdk, writeSdkTypes } from '@/lib/workflows/code/sdk-typecheck.test-helpers'

const workDir = mkdtempSync(path.join(tmpdir(), 'workflow-code-typecheck-corpus-'))

afterAll(() => rmSync(workDir, { recursive: true, force: true }))

const subjects = corpusSubjects()

const FULL = process.env.ROUNDTRIP_CORPUS_FULL === '1'

/**
 * Corpus workflows whose print does not type-check yet, by cause: stored shapes the SDK types do
 * not model. The list only shrinks. A failing workflow no entry matches fails the run, and in a
 * full run so does an entry that matches no failing workflow.
 */
const KNOWN_UNTYPED: ReadonlyArray<{ match: RegExp; cause: string }> = [
  { match: /^fuzz:/, cause: 'generated graphs reference outputs their blocks lack' },
  { match: /^unicode-names:function:/, cause: 'a reference to an output the block lacks' },
  {
    match: /^landing-template:/,
    cause:
      'template values: a legacy Slack block with no destination, messages stored as text, references into untyped JSON outputs',
  },
  { match: /^testing:builder-/, cause: 'function blocks stored with no code' },
  { match: /^testing:complex$/, cause: 'table rows stored as pairs' },
  {
    match: /:(response|human_in_the_loop|human_in_the_loop_v2):/,
    cause: 'a response format stored as text',
  },
  { match: /:workflow_input:/, cause: 'an input mapping stored as JSON text' },
  {
    match: /^(operation|error-edge|variables):variables:/,
    cause: 'variable rows with no variableId',
  },
  { match: /:(jina|guardrails|pinecone):/, cause: 'a checkbox list stored as an object' },
  {
    match: /:table_v2:(query_rows|batch_insert_rows)(:|$)/,
    cause: 'sort rows that keep their ids, rows outside the table schema',
  },
  { match: /:(zoho_desk|file_v5):/, cause: 'a list stored in a single-value field' },
  { match: /:sailpoint(_v2)?:sailpoint_search_aggregate(:|$)/, cause: 'a nested query object' },
  { match: /:(agiloft|coda):/, cause: 'a gated param written outside its variant' },
  {
    match: /^legacy-scalars:.*:gating-text$/,
    cause: 'a switch another field reads holding legacy text, which stays text',
  },
]

const knownCause = (id: string) => KNOWN_UNTYPED.find(({ match }) => match.test(id))

describe(`printed corpus source type-checks against the SDK (${subjects.length} workflows)`, () => {
  it(
    'type-checks every printed workflow',
    () => {
      writeSdkTypes(workDir, catalog)
      const sourceDir = path.join(workDir, 'src')
      mkdirSync(sourceDir, { recursive: true })
      const files = new Map<string, string>()
      subjects.forEach((subject, index) => {
        const workflow = canonicalize(subject.state, {
          catalog,
          meta: { name: subject.id, description: null },
          resources: CORPUS_RESOURCES,
        }).workflow
        const [entry] = printWorkflow({
          workflow,
          catalog,
          options: { functionCode: 'inline' },
        }).files
        const file = `w${index}.ts`
        writeFileSync(path.join(sourceDir, file), entry.text)
        files.set(file, subject.id)
      })
      const output = typeCheckAgainstSdk(workDir, 'corpus', [path.join(sourceDir, '*.ts')])
      const failures = new Map<string, string[]>()
      for (const line of output.split('\n')) {
        const match = line.match(/src\/(w\d+\.ts)\((\d+),\d+\): error (TS\d+: .*)/)
        if (!match) continue
        const id = files.get(match[1]) ?? match[1]
        failures.set(id, [...(failures.get(id) ?? []), `${match[2]}: ${match[3]}`])
      }
      const stray = output
        .split('\n')
        .filter((line) => line.includes('error TS') && !/src\/w\d+\.ts\(/.test(line))
      expect(stray).toEqual([])
      const unexpected = [...failures].filter(([id]) => !knownCause(id))
      expect(Object.fromEntries(unexpected.slice(0, 20))).toEqual({})
      if (FULL) {
        const stale = KNOWN_UNTYPED.filter(({ match }) =>
          [...failures.keys()].every((id) => !match.test(id))
        )
        expect(stale.map(({ cause }) => cause)).toEqual([])
      }
    },
    corpusBudgetMs(subjects.length * 4, 120_000)
  )
})
