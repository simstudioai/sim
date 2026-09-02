/**
 * @vitest-environment jsdom
 */
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { workflowFixture } = vi.hoisted(() => ({
  workflowFixture: {
    rootBlocks: {
      invoke: {
        id: 'invoke',
        type: 'workflow_input',
        name: 'invokeChild',
        position: { x: 0, y: 0 },
        subBlocks: {
          workflowId: {
            id: 'workflowId',
            type: 'workflow-selector',
            value: 'child-workflow',
          },
        },
        outputs: {},
        enabled: true,
        data: { canonicalModes: { workflowId: 'basic' } },
      },
    },
    childState: {
      blocks: {
        agent: {
          id: 'agent',
          type: 'agent',
          name: 'researchAgent',
          position: { x: 0, y: 0 },
          subBlocks: {},
          outputs: {},
          enabled: true,
        },
      },
      edges: [],
    },
  },
}))

vi.mock('zustand/react/shallow', () => ({ useShallow: (selector: unknown) => selector }))

vi.mock('@/blocks/block-tile', () => ({
  BlockTile: ({ blockType }: { blockType: string }) => <span data-block-type={blockType} />,
}))

vi.mock('@/lib/workflows/blocks/flatten-outputs', () => ({
  flattenWorkflowOutputs: (blocks: Iterable<{ id: string; name: string; type: string }>) =>
    [...blocks].flatMap((block) => {
      if (block.type === 'workflow_input') {
        return ['success', 'childWorkflowName', 'childWorkflowId', 'result', 'error'].map(
          (path) => ({
            blockId: block.id,
            blockName: block.name,
            blockType: block.type,
            path,
          })
        )
      }
      if (block.type === 'agent') {
        return [
          { blockId: block.id, blockName: block.name, blockType: block.type, path: 'content' },
        ]
      }
      return []
    }),
}))

vi.mock('@/hooks/queries/workflows', () => ({
  useWorkflowStates: (workflowIds: string[]) =>
    new Map(
      workflowIds.map((workflowId) => [
        workflowId,
        workflowId === 'child-workflow' ? workflowFixture.childState : null,
      ])
    ),
}))

vi.mock('@/stores/workflow-diff/store', () => ({
  useWorkflowDiffStore: (selector: (state: object) => unknown) =>
    selector({
      isShowingDiff: false,
      isDiffReady: false,
      hasActiveDiff: false,
      baselineWorkflow: null,
    }),
}))

vi.mock('@/stores/workflows/subblock/store', () => ({
  useSubBlockStore: (selector: (state: object) => unknown) =>
    selector({ workflowValues: { root: { invoke: { workflowId: 'child-workflow' } } } }),
}))

vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: (selector: (state: object) => unknown) =>
    selector({ blocks: workflowFixture.rootBlocks, edges: [] }),
}))

import { OutputSelect } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/chat/components/output-select/output-select'

let root: Root | null = null
let container: HTMLDivElement | null = null

function renderPicker() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  function Picker() {
    const [selectedOutputs, setSelectedOutputs] = useState<string[]>([])
    return (
      <OutputSelect
        workflowId='root'
        selectedOutputs={selectedOutputs}
        onOutputSelect={setSelectedOutputs}
        size='md'
      />
    )
  }

  act(() => root?.render(<Picker />))
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('OutputSelect DOM interaction', () => {
  it('drills into and selects a child workflow output through the real medium combobox', () => {
    renderPicker()

    const trigger = document.querySelector<HTMLElement>('[role="combobox"]')
    if (!trigger) throw new Error('Output picker trigger did not render')
    act(() => trigger.click())

    expect(document.body.textContent).toContain('invokeChild')
    const rootOptions = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    const folderOption = rootOptions.find((candidate) => candidate.textContent === 'Outputs')
    if (!folderOption) throw new Error('Child workflow folder did not render')
    expect(rootOptions.indexOf(folderOption)).toBeLessThan(
      rootOptions.findIndex((candidate) => candidate.textContent === 'result')
    )
    const floatingSurface = folderOption.closest<HTMLElement>('[data-native-surface-overlay]')
    if (!floatingSurface) throw new Error('Output picker floating surface did not render')

    expect(floatingSurface.className).toContain('pointer-events-auto')
    act(() => folderOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))

    expect(document.body.textContent).toContain('researchAgent')
    const outputOption = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (candidate) => candidate.textContent === 'content'
    )
    if (!outputOption) throw new Error('Child workflow output did not render')

    act(() => outputOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))

    expect(trigger.textContent).toContain('1 output')
    expect(document.body.textContent).toContain('Selected')
    expect(document.body.textContent).toContain('invokeChild / researchAgent / content')
  })
})
