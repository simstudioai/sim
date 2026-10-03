/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import {
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

  it('excludes a block that is downstream of the referencing one', () => {
    const harness = renderPrefixes('a')
    expect(harness.result()?.has(normalizeName('Bravo'))).toBe(false)
    harness.unmount()
  })
})
