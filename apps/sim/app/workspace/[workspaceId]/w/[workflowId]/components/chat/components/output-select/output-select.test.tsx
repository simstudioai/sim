/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { outputMenuState } = vi.hoisted(() => ({
  outputMenuState: {
    includeNestedWorkflow: true,
    workflowBlocks: {} as Record<string, object>,
    workflowValues: { root: {} } as Record<string, Record<string, Record<string, unknown>>>,
    capturedRootState: null as {
      blocks: Record<string, { subBlocks: Record<string, { value?: unknown }> }>
    } | null,
  },
}))

vi.mock('@sim/emcn', () => {
  interface MockComboboxProps {
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
  }

  const MockCombobox = ({
    groups,
    multiSelectValues = [],
    onMultiSelectChange,
  }: MockComboboxProps) => (
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
  )

  return {
    cn: (...values: unknown[]) => values.flat().filter(Boolean).join(' '),
    Combobox: MockCombobox,
    ChipCombobox: (props: MockComboboxProps) => (
      <div data-chip-combobox>
        <MockCombobox {...props} />
      </div>
    ),
  }
})

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
    selector({ workflowValues: outputMenuState.workflowValues }),
}))

vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: (selector: (state: object) => unknown) =>
    selector({ blocks: outputMenuState.workflowBlocks, edges: [] }),
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
    buildWorkflowOutputOptions: (input: {
      rootState: {
        blocks: Record<string, { subBlocks: Record<string, { value?: unknown }> }>
      }
    }) => {
      outputMenuState.capturedRootState = input.rootState
      return outputMenuState.includeNestedWorkflow ? [rootOutput, nestedOutput] : [rootOutput]
    },
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
  outputMenuState.workflowBlocks = {}
  outputMenuState.workflowValues = { root: {} }
  outputMenuState.capturedRootState = null
})

function outputSelect(
  workflowId: string,
  selectedOutputs: string[],
  onOutputSelect: (outputIds: string[]) => void,
  valueMode: 'id' | 'label' | 'public' = 'id',
  size: 'sm' | 'md' = 'sm'
) {
  return (
    <OutputSelect
      workflowId={workflowId}
      selectedOutputs={selectedOutputs}
      onOutputSelect={onOutputSelect}
      valueMode={valueMode}
      size={size}
    />
  )
}

function renderOutputSelect(
  selectedOutputs: string[],
  onOutputSelect = vi.fn(),
  valueMode: 'id' | 'label' | 'public' = 'id',
  size: 'sm' | 'md' = 'sm'
) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(outputSelect('root', selectedOutputs, onOutputSelect, valueMode, size))
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

    expect([...document.querySelectorAll('[data-section]')][0]?.textContent).toBe('Subworkflows')
    clickOption('Research')
    expect(document.body.textContent).toContain('Back')
    expect(document.body.textContent).toContain('Writer')
    expect(document.body.textContent).toContain('answer')
    expect(document.body.textContent).not.toContain('Summarizer')
  })

  it('preserves a persisted workflow target when the editor value map is sparse', () => {
    outputMenuState.workflowBlocks = {
      invoke: {
        id: 'invoke',
        type: 'workflow_input',
        name: 'Research',
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
      },
    }

    renderOutputSelect([])

    expect(outputMenuState.capturedRootState?.blocks.invoke.subBlocks.workflowId.value).toBe(
      'child-workflow'
    )
  })

  it('keeps workflow-scoped values when toggling nested outputs', () => {
    const onOutputSelect = renderOutputSelect([])
    clickOption('Research')
    clickOption('answer')

    expect(onOutputSelect).toHaveBeenCalledWith(['child-workflow.agent_answer'])
  })

  it('keeps every selected output at the top and deselects nested outputs from there', () => {
    const onOutputSelect = renderOutputSelect(['child-workflow.agent_answer'])

    const sections = [...document.querySelectorAll('[data-section]')]
    expect(sections[0]?.textContent).toBe('Selected')
    expect(document.body.textContent).toContain('Research / Writer.answer')

    clickOption('Research / Writer.answer')
    expect(onOutputSelect).toHaveBeenCalledWith([])
  })

  it('preserves existing selections when choosing a nested output', () => {
    const onOutputSelect = renderOutputSelect(['summary_content'])

    clickOption('Research')
    clickOption('answer')

    expect(onOutputSelect).toHaveBeenCalledWith(['summary_content', 'child-workflow.agent_answer'])
  })

  it('selects outputs from the medium chat deployment picker', () => {
    const onOutputSelect = renderOutputSelect([], vi.fn(), 'id', 'md')

    expect(document.querySelector('[data-chip-combobox]')).not.toBeNull()
    clickOption('content')

    expect(onOutputSelect).toHaveBeenCalledWith(['summary_content'])
  })

  it('emits public dot selectors for trigger authoring', () => {
    const onOutputSelect = renderOutputSelect([], vi.fn(), 'public')

    clickOption('content')
    expect(onOutputSelect).toHaveBeenCalledWith(['summarizer.content'])

    clickOption('Research')
    clickOption('answer')
    expect(onOutputSelect).toHaveBeenCalledWith(['child-workflow.writer.answer'])
  })

  it('returns to the root menu when the owning workflow changes', () => {
    const onOutputSelect = renderOutputSelect([])
    clickOption('Research')

    rerenderOutputSelect('replacement', [], onOutputSelect)

    expect(document.body.textContent).toContain('Summarizer')
    expect(document.body.textContent).not.toContain('Back')
  })

  it('returns to the root menu when a workflow edit invalidates the active path', () => {
    const onOutputSelect = renderOutputSelect([])
    clickOption('Research')

    outputMenuState.includeNestedWorkflow = false
    rerenderOutputSelect('root', [], onOutputSelect)

    expect(document.body.textContent).toContain('Summarizer')
    expect(document.body.textContent).not.toContain('Back')
  })
})
