/**
 * A secret pasted into a password field never reaches source: the printer writes
 * `stored()` for it, and apply keeps the stored value.
 *
 * For every corpus workflow, every password subBlock the stored block holds gets a unique secret.
 * The print, in both function-code modes, must not contain any of them, and the
 * print compiled against the stored workflow (as apply compiles it) must hold each secret the
 * print left out wherever it runs.
 */
import { compareStrings } from '@sim/utils/string'
import {
  type CanonicalWorkflow,
  canonicalize,
  catalogBlock,
  compileWorkflow,
  executableView,
  printWorkflow,
} from '@sim/workflow-code'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')
vi.unmock('@/tools/metadata-outputs')
vi.unmock('@/tools/registry')

import { registryCatalog as catalog } from '@/lib/workflows/code/catalog/registry-catalog.test-helpers'
import { corpusBudgetMs, corpusSubjects } from '@/lib/workflows/code/corpus/fixtures.test-helpers'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const subjects = corpusSubjects()

/** The state with a unique secret in every password subBlock it stores, and those secrets. */
function withSecrets(state: WorkflowState): { state: WorkflowState; secrets: string[] } {
  const next = structuredClone(state)
  const secrets: string[] = []
  for (const block of Object.values(next.blocks)) {
    const declared = catalogBlock(catalog, block.type)
    if (!declared) continue
    const passwords = new Set(
      declared.subBlocks.filter((subBlock) => subBlock.password).map((subBlock) => subBlock.id)
    )
    for (const [id, subBlock] of Object.entries(block.subBlocks ?? {})) {
      if (!passwords.has(id)) continue
      const secret = `sk-secret-${secrets.length}-${block.id}`
      subBlock.value = secret
      secrets.push(secret)
    }
  }
  return { state: next, secrets }
}

/** What the workflow runs with, as JSON, so a secret can be found wherever it landed. */
function executableText(workflow: CanonicalWorkflow): string {
  return JSON.stringify(executableView(workflow, catalog))
}

describe(`secrets never print (${subjects.length} workflows)`, () => {
  it(
    'prints stored() for every password value and compiles it back to the stored value',
    () => {
      const leaks: string[] = []
      const lost: string[] = []
      let printedAway = 0
      for (const subject of subjects) {
        if (subject.unknownTypes) continue
        const { state, secrets } = withSecrets(subject.state)
        if (secrets.length === 0) continue
        const stored = canonicalize(state, {
          catalog,
          meta: { name: subject.id, description: null },
        }).workflow
        for (const functionCode of ['inline', 'files'] as const) {
          const printed = printWorkflow({
            workflow: stored,
            catalog,
            options: { functionCode },
          })
          const text = printed.files.map((file) => file.text).join('\n')
          for (const secret of secrets) {
            if (text.includes(secret)) {
              leaks.push(`${subject.id} (${functionCode}): ${secret}`)
            }
          }
          if (functionCode === 'files') continue
          const [entry, ...files] = printed.files
          const compiled = compileWorkflow({
            entry,
            files: new Map(files.map((file) => [file.path, file.text])),
            catalog,
            sdkMajor: catalog.sdkMajor,
            knownKeys: new Set(Object.keys(stored.blocks)),
            stored,
          })
          const before = executableText(stored)
          const after = compiled.workflow ? executableText(compiled.workflow) : ''
          for (const secret of secrets) {
            if (!before.includes(secret)) continue
            printedAway += 1
            if (!after.includes(secret)) lost.push(`${subject.id}: ${secret}`)
          }
        }
      }
      expect(printedAway).toBeGreaterThan(0)
      expect(leaks.sort(compareStrings)).toEqual([])
      expect(lost.sort(compareStrings)).toEqual([])
    },
    corpusBudgetMs(subjects.length)
  )
})
