/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import {
  buildWorkflowReferenceScope,
  type WorkflowReferenceScope,
  WorkflowReferenceScopeProvider,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/workflow-reference-scope'
import { normalizeName } from '@/executor/constants'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { BlockState } from '@/stores/workflows/workflow/types'

const WORKFLOW_ID = 'wf-1'

function block(id: string, name: string): BlockState {
  return { id, name, type: 'agent', subBlocks: {} } as unknown as BlockState
}

/** A → B → C, so only A is upstream of B and only A/B are upstream of C. */
const GRAPH = {
  blocks: { a: block('a', 'Alpha'), b: block('b', 'Bravo'), c: block('c', 'Charlie') },
  edges: [
    { id: 'e1', source: 'a', target: 'b' },
    { id: 'e2', source: 'b', target: 'c' },
  ],
}

interface Harness {
  result: () => Set<string> | undefined
  renderCount: () => number
  unmount: () => void
}

function renderPrefixes(blockId: string | undefined, scope?: WorkflowReferenceScope): Harness {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  let latest: Set<string> | undefined
  let renders = 0

  function Probe() {
    renders += 1
    latest = useAccessibleReferencePrefixes(blockId)
    return null
  }

  act(() => {
    root.render(
      scope ? (
        <WorkflowReferenceScopeProvider scope={scope}>
          <Probe />
        </WorkflowReferenceScopeProvider>
      ) : (
        <Probe />
      )
    )
  })

  return {
    result: () => latest,
    renderCount: () => renders,
    unmount: () => act(() => root.unmount()),
  }
}

describe('useAccessibleReferencePrefixes', () => {
  beforeEach(() => {
    useWorkflowStore.setState({ ...GRAPH, loops: {}, parallels: {} })
    useWorkflowRegistry.setState({ activeWorkflowId: WORKFLOW_ID })
    useSubBlockStore.setState({ workflowValues: { [WORKFLOW_ID]: {} } })
  })

  it('offers only the referencing block and its ancestors on the canvas', () => {
    const harness = renderPrefixes('c')
    const prefixes = harness.result()
    expect(prefixes?.has(normalizeName('Alpha'))).toBe(true)
    expect(prefixes?.has(normalizeName('Bravo'))).toBe(true)
    expect(prefixes?.has(normalizeName('Charlie'))).toBe(true)
    harness.unmount()
  })

  it('excludes a block that is downstream of the referencing one', () => {
    const harness = renderPrefixes('a')
    expect(harness.result()?.has(normalizeName('Bravo'))).toBe(false)
    harness.unmount()
  })

  it('does not re-render when a sub-block VALUE changes', () => {
    // Reachability cannot change with the text being typed, and this hook runs in every
    // reference-aware sub-block editor at once. Subscribing it to the sub-block store would
    // re-render all of them on every keystroke anywhere in the workflow.
    const harness = renderPrefixes('c')
    const before = harness.renderCount()
    act(() => {
      useSubBlockStore.setState({ workflowValues: { [WORKFLOW_ID]: { a: { prompt: 'typing' } } } })
    })
    expect(harness.renderCount()).toBe(before)
    harness.unmount()
  })

  it('still re-renders when the graph itself changes', () => {
    const harness = renderPrefixes('c')
    const before = harness.renderCount()
    act(() => {
      useWorkflowStore.setState({
        blocks: { ...GRAPH.blocks, a: block('a', 'Renamed') },
      })
    })
    expect(harness.renderCount()).toBeGreaterThan(before)
    expect(harness.result()?.has(normalizeName('Renamed'))).toBe(true)
    harness.unmount()
  })

  it('resolves against a supplied graph instead of the editor’s', () => {
    const scope = buildWorkflowReferenceScope({
      workflowId: 'other-wf',
      blocks: { x: block('x', 'Extract'), y: block('y', 'Load') },
      edges: [{ id: 'e', source: 'x', target: 'y' }],
      referencingBlockId: 'y',
    })
    const harness = renderPrefixes('y', scope)
    const prefixes = harness.result()
    expect(prefixes?.has(normalizeName('Extract'))).toBe(true)
    // The editor's own workflow must not leak in.
    expect(prefixes?.has(normalizeName('Alpha'))).toBe(false)
    harness.unmount()
  })

  it('offers every block when the referencing one is absent from the supplied graph', () => {
    // A block this sync is about to ADD has no position in the target workflow yet; the
    // ancestor walk would return nothing and suggest nothing at all.
    const scope = buildWorkflowReferenceScope({
      workflowId: 'other-wf',
      blocks: { x: block('x', 'Extract'), y: block('y', 'Load') },
      edges: [{ id: 'e', source: 'x', target: 'y' }],
      referencingBlockId: 'not-in-this-workflow',
    })
    const harness = renderPrefixes('not-in-this-workflow', scope)
    const prefixes = harness.result()
    expect(prefixes?.has(normalizeName('Extract'))).toBe(true)
    expect(prefixes?.has(normalizeName('Load'))).toBe(true)
    harness.unmount()
  })
})
