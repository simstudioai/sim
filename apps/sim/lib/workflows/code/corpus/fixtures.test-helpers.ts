/**
 * The real-state corpora (s3 §5 corpus 2) that live in this public repo: the landing-page
 * templates and the states `@sim/testing` builds. Agent-authored states from the private copilot
 * repo and anything exported from production stay out of the repo; `scripts/export-redacted-
 * workflows.ts` writes redacted production states to a directory outside it, and a caller points
 * the harness there with `ROUNDTRIP_CORPUS_EXTRA_DIR`.
 *
 * Test-only: it imports `@sim/testing` (a devDependency) and reads the filesystem.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { WorkflowBuilder } from '@sim/testing/builders'
import {
  createComplexWorkflowState,
  createConditionalWorkflowState,
  createLoopWorkflowState,
  createMinimalWorkflowState,
} from '@sim/testing/factories'
import { omit } from '@sim/utils/object'
import { compareStrings } from '@sim/utils/string'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

export interface FixtureState {
  /** `<source>:<name>`, stable across runs. */
  id: string
  state: WorkflowState
}

const LANDING_TEMPLATES_DIR = path.resolve(process.cwd(), 'public/landing-page-templates')

/** Reads exported workflow files (`{ version, exportedAt, state }` or a bare state) from a directory. */
export function loadWorkflowStatesFromDirectory(directory: string, source: string): FixtureState[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .sort(compareStrings)
    .map((file) => {
      const parsed: unknown = JSON.parse(readFileSync(path.join(directory, file), 'utf8'))
      return {
        id: `${source}:${file.replace(/\.json$/, '')}`,
        state: toWorkflowState(parsed, file),
      }
    })
}

function toWorkflowState(parsed: unknown, file: string): WorkflowState {
  const envelope = parsed && typeof parsed === 'object' && 'state' in parsed ? parsed.state : parsed
  if (
    !envelope ||
    typeof envelope !== 'object' ||
    !('blocks' in envelope) ||
    !('edges' in envelope)
  ) {
    throw new Error(`${file} is not an exported workflow state`)
  }
  const state = envelope as WorkflowState
  return { ...state, loops: state.loops ?? {}, parallels: state.parallels ?? {} }
}

/** The 11 landing-page templates in `public/landing-page-templates`. */
export function loadLandingTemplateStates(): FixtureState[] {
  return loadWorkflowStatesFromDirectory(LANDING_TEMPLATES_DIR, 'landing-template')
}

type FactoryOutput = Omit<WorkflowState, 'parallels'> & {
  parallels?: WorkflowState['parallels']
  isDeployed?: boolean
}

/** Drops the builder's wall-clock and deploy fields, which are not part of a stored graph. */
function stored(state: FactoryOutput): WorkflowState {
  const graph = omit(state, ['lastSaved', 'isDeployed'])
  return { ...graph, parallels: graph.parallels ?? {} }
}

/** States from the shared `@sim/testing` factories and builder presets. */
export function buildTestingFactoryStates(): FixtureState[] {
  const fixtures: Array<[string, FactoryOutput]> = [
    ['minimal', createMinimalWorkflowState()],
    ['conditional', createConditionalWorkflowState()],
    ['loop', createLoopWorkflowState()],
    ['complex', createComplexWorkflowState()],
    ['builder-linear', WorkflowBuilder.linear(5).build()],
    ['builder-branching', WorkflowBuilder.branching().build()],
    ['builder-loop', WorkflowBuilder.withLoop(4).build()],
    ['builder-parallel', WorkflowBuilder.withParallel(3).build()],
  ]
  return fixtures.map(([name, state]) => ({ id: `testing:${name}`, state: stored(state) }))
}
