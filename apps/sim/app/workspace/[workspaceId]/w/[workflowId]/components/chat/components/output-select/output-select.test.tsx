/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { outputMenuState } = vi.hoisted(() => ({
  outputMenuState: { includeNestedWorkflow: true },
}))

vi.mock('@sim/emcn', () => ({
  cn: (...values: unknown[]) => values.flat().filter(Boolean).join(' '),
  Combobox: ({
    groups,
    multiSelectValues = [],
    onMultiSelectChange,
  }: {
    groups: Array<{
      section?: string
      sectionElement?: ReactNode
      items: Array<{
        label: string
        value: string
        iconElement?: ReactNode
        suffixElement?: ReactNode
        onSelect?: () => void
      }>
    }>
    multiSelectValues?: string[]
    onMultiSelectChange?: (values: string[]) => void
  }) => (
    <div>
      {groups.map((group, groupIndex) => (
        <div key={group.section ?? groupIndex}>
          {group.sectionElement}
          {group.section ? <span data-section>{group.section}</span> : null}
          {group.items.map((option) => (
            <button
              key={option.value}
              type='button'
              onClick={() => {
                if (option.onSelect) {
                  option.onSelect()
                  return
                }
                onMultiSelectChange?.(
                  multiSelectValues.includes(option.value)
                    ? multiSelectValues.filter((value) => value !== option.value)
                    : [...multiSelectValues, option.value]
                )
              }}
            >
              {option.iconElement}
              {option.label}
              {option.suffixElement}
            </button>
          ))}
        </div>
      ))}
    </div>
  ),
  ChipCombobox: ({
    groups,
    multiSelectValues,
    onMultiSelectChange,
    disablePortal,
  }: {
    groups: Array<{ section?: string; items: Array<{ label: string; value: string }> }>
    multiSelectValues?: string[]
    onMultiSelectChange?: (values: string[]) => void
    disablePortal?: boolean
  }) => (
    <div data-chip-combobox data-disable-portal={disablePortal || undefined}>
      {groups.flatMap((group) =>
        group.items.map((option) => (
          <button
            key={option.value}
            type='button'
            onClick={() => onMultiSelectChange?.([...(multiSelectValues ?? []), option.value])}
          >
            {option.label}
          </button>
        ))
      )}
    </div>
  ),
}))

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
  const nestedOutput = {
    id: 'child-workflow.agent_answer',
    label: 'child-workflow.writer.answer',
    workflowId: 'child-workflow',
    blockId: 'agent',
    blockName: 'Writer',
    blockType: 'agent',
    groupKey: 'workflow/agent',
    groupLabel: 'Research / Writer',
    path: 'answer',
    menuPath: [],
  }

  return {
    collectReferencedWorkflowIds: () => [],
    buildWorkflowOutputOptions: () =>
      outputMenuState.includeNestedWorkflow ? [rootOutput, nestedOutput] : [rootOutput],
    buildWorkflowOutputMenu: () => {
      const rootNode = {
        blockId: 'summary',
        blockName: 'Summarizer',
        blockType: 'agent',
        outputs: [rootOutput],
        children: [],
      }
      return outputMenuState.includeNestedWorkflow
        ? [
            rootNode,
            {
              blockId: 'workflow',
              blockName: 'Research',
              blockType: 'workflow_input',
              outputs: [],
              children: [
                {
                  blockId: 'workflow/agent',
                  blockName: 'Writer',
                  blockType: 'agent',
                  outputs: [nestedOutput],
                  children: [],
                },
              ],
            },
          ]
        : [rootNode]
    },
  }
})

import { OutputSelect } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/chat/components/output-select/output-select'

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeEach(() => {
  outputMenuState.includeNestedWorkflow = true
})

function outputSelect(
  workflowId: string,
  selectedOutputs: string[],
  onOutputSelect: (outputIds: string[]) => void,
  valueMode: 'id' | 'label' | 'public' = 'id'
) {
  return (
    <OutputSelect
      workflowId={workflowId}
      selectedOutputs={selectedOutputs}
      onOutputSelect={onOutputSelect}
      valueMode={valueMode}
    />
  )
}

function renderOutputSelect(
  selectedOutputs: string[],
  onOutputSelect = vi.fn(),
  valueMode: 'id' | 'label' | 'public' = 'id',
  props: { size?: 'sm' | 'md'; disablePortal?: boolean } = {}
) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(
      <OutputSelect
        workflowId='root'
        selectedOutputs={selectedOutputs}
        onOutputSelect={onOutputSelect}
        valueMode={valueMode}
        {...props}
      />
    )
  })
  return onOutputSelect
}

function rerenderOutputSelect(
  workflowId: string,
  selectedOutputs: string[],
  onOutputSelect: (outputIds: string[]) => void
) {
  act(() => {
    root?.render(outputSelect(workflowId, selectedOutputs, onOutputSelect))
  })
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('OutputSelect nested workflow menu', () => {
  const clickOption = (label: string) => {
    const option = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === label
    )
    if (!(option instanceof HTMLButtonElement))
      throw new Error(`Output option did not render: ${label}`)
    act(() => option.click())
  }

  it('keeps root outputs visible and drills into workflow block outputs', () => {
    renderOutputSelect([])

    expect(document.body.textContent).toContain('Summarizer')
    expect(document.body.textContent).toContain('content')
    expect(document.body.textContent).toContain('Research')
    expect(document.body.textContent).not.toContain('Writer')

    clickOption('Outputs')
    expect(document.body.textContent).toContain('Back')
    expect(document.body.textContent).toContain('Writer')
    expect(document.body.textContent).toContain('answer')
    expect(document.body.textContent).not.toContain('Summarizer')
  })

  it('forwards inline dropdown rendering to the chip combobox', () => {
    renderOutputSelect([], vi.fn(), 'id', { size: 'md', disablePortal: true })

    expect(container.querySelector('[data-chip-combobox]')).toHaveAttribute(
      'data-disable-portal',
      'true'
    )
  })

  it('keeps workflow-scoped values when toggling nested outputs', () => {
    const onOutputSelect = renderOutputSelect([])
    clickOption('Outputs')
    clickOption('answer')

    expect(onOutputSelect).toHaveBeenCalledWith(['child-workflow.agent_answer'])
  })

  it('emits public dot selectors for trigger authoring', () => {
    const onOutputSelect = renderOutputSelect([], vi.fn(), 'public')

    clickOption('content')
    expect(onOutputSelect).toHaveBeenCalledWith(['summarizer.content'])

    clickOption('Outputs')
    clickOption('answer')
    expect(onOutputSelect).toHaveBeenCalledWith(['child-workflow.writer.answer'])
  })

  it('returns to the root menu when the owning workflow changes', () => {
    const onOutputSelect = renderOutputSelect([])
    clickOption('Outputs')

    rerenderOutputSelect('replacement', [], onOutputSelect)

    expect(document.body.textContent).toContain('Summarizer')
    expect(document.body.textContent).not.toContain('Back')
  })

  it('returns to the root menu when a workflow edit invalidates the active path', () => {
    const onOutputSelect = renderOutputSelect([])
    clickOption('Outputs')

    outputMenuState.includeNestedWorkflow = false
    rerenderOutputSelect('root', [], onOutputSelect)

    expect(document.body.textContent).toContain('Summarizer')
    expect(document.body.textContent).not.toContain('Back')
  })
})
