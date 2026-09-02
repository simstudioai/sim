/**
 * @vitest-environment jsdom
 */
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('zustand/react/shallow', () => ({ useShallow: (selector: unknown) => selector }))

vi.mock('@/blocks/block-tile', () => ({
  BlockTile: ({ blockType }: { blockType: string }) => <span data-block-type={blockType} />,
}))

vi.mock('@/hooks/queries/workflows', () => ({ useWorkflowStates: () => new Map() }))

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
    selector({ workflowValues: { root: {} } }),
}))

vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: (selector: (state: object) => unknown) => selector({ blocks: {}, edges: [] }),
}))

vi.mock('@/lib/workflows/streaming/nested-output-options', () => {
  const rootOutput = {
    id: 'summary_content',
    label: 'Summarizer.content',
    blockId: 'summary',
    blockName: 'Summarizer',
    blockType: 'agent',
    groupKey: 'summary',
    groupLabel: 'Summarizer',
    path: 'content',
    menuPath: [],
  }

  return {
    collectReferencedWorkflowIds: () => [],
    buildWorkflowOutputOptions: () => [rootOutput],
    buildWorkflowOutputMenu: () => [
      {
        blockId: 'summary',
        blockName: 'Summarizer',
        blockType: 'agent',
        outputs: [rootOutput],
        children: [],
      },
    ],
  }
})

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
  it('selects an output through the real medium combobox', () => {
    renderPicker()

    const trigger = document.querySelector<HTMLElement>('[role="combobox"]')
    if (!trigger) throw new Error('Output picker trigger did not render')
    act(() => trigger.click())

    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (candidate) => candidate.textContent === 'content'
    )
    if (!option) throw new Error('Output option did not render')
    const floatingSurface = option.closest<HTMLElement>('[data-native-surface-overlay]')
    if (!floatingSurface) throw new Error('Output picker floating surface did not render')

    expect(floatingSurface.className).toContain('pointer-events-auto')

    act(() => option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))

    expect(trigger.textContent).toContain('1 output')
    expect(document.body.textContent).toContain('Selected')
  })
})
