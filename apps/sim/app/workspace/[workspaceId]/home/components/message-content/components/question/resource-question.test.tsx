/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseWorkflows, mockUseTablesList } = vi.hoisted(() => ({
  mockUseWorkflows: vi.fn(),
  mockUseTablesList: vi.fn(),
}))

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/hooks/queries/workflows', () => ({ useWorkflows: mockUseWorkflows }))
vi.mock('@/hooks/queries/tables', () => ({ useTablesList: mockUseTablesList }))
vi.mock('@/hooks/queries/workspace-files', () => ({
  useWorkspaceFiles: () => ({ data: undefined, isPending: false }),
}))
vi.mock('@/hooks/queries/kb/knowledge', () => ({
  useKnowledgeBasesQuery: () => ({ data: undefined, isPending: false }),
}))

import {
  parseQuestionAnswerMessage,
  QuestionDisplay,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/question/question'
import type {
  InteractionAnswerHandler,
  QuestionItem,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags'

const WORKFLOWS = Array.from({ length: 11 }, (_, i) => ({
  id: `wf-${i + 1}`,
  name: `Workflow ${i + 1}`,
}))

const PICK_WORKFLOW: QuestionItem = {
  type: 'resource_select',
  prompt: 'Which workflow should I improve?',
  resourceType: 'workflow',
}

let container: HTMLDivElement
let root: Root

function render(data: QuestionItem[], onSelect?: InteractionAnswerHandler) {
  act(() => {
    root.render(<QuestionDisplay data={data} onSelect={onSelect} />)
  })
}

function rowLabels(): string[] {
  return Array.from(container.querySelectorAll('button'))
    .map((button) => button.textContent?.trim() ?? '')
    .filter((text) => text.startsWith('Workflow '))
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function clickRow(label: string) {
  const row = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === label
  )
  if (!row) throw new Error(`no row ${label}`)
  act(() => {
    row.click()
  })
}

describe('resource_select question', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    nextNavigationMockFns.mockUseParams.mockReturnValue({ workspaceId: 'ws-1' })
    mockUseWorkflows.mockReturnValue({ data: WORKFLOWS, isPending: false })
    mockUseTablesList.mockReturnValue({ data: undefined, isPending: false })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('lists every workspace resource of the family, past the four-option cap', () => {
    render([PICK_WORKFLOW], vi.fn())
    expect(rowLabels()).toEqual(WORKFLOWS.map((workflow) => workflow.name))
    expect(mockUseWorkflows).toHaveBeenCalledWith('ws-1', { enabled: true })
    expect(mockUseTablesList).toHaveBeenCalledWith('ws-1', 'active', { enabled: false })
  })

  it('mounts a bounded preview of a large workspace and searches the rest', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      id: `wf-${i + 1}`,
      name: `Workflow ${i + 1}`,
    }))
    mockUseWorkflows.mockReturnValue({ data: many, isPending: false })
    render([PICK_WORKFLOW], vi.fn())
    expect(rowLabels()).toHaveLength(50)
    expect(container.textContent).toContain('10 more workflows — type to search')

    typeInto(container.querySelector('input') as HTMLInputElement, 'workflow 60')
    expect(rowLabels()).toEqual(['Workflow 60'])
  })

  it('answers with the picked name and attaches the resource as a chat context', () => {
    const onSelect = vi.fn<InteractionAnswerHandler>()
    render([PICK_WORKFLOW], onSelect)
    clickRow('Workflow 7')

    expect(onSelect).toHaveBeenCalledTimes(1)
    const [message, contexts] = onSelect.mock.calls[0]
    expect(message).toBe('Which workflow should I improve? — Workflow 7')
    expect(contexts).toEqual([{ kind: 'workflow', workflowId: 'wf-7', label: 'Workflow 7' }])
    expect(parseQuestionAnswerMessage([PICK_WORKFLOW], message)).toEqual(['Workflow 7'])
  })

  it('filters by the typed text and sends unmatched text as a plain answer', () => {
    const onSelect = vi.fn<InteractionAnswerHandler>()
    render([PICK_WORKFLOW], onSelect)
    const input = container.querySelector('input') as HTMLInputElement

    typeInto(input, 'workflow 1')
    expect(rowLabels()).toEqual(['Workflow 1', 'Workflow 10', 'Workflow 11'])

    typeInto(input, 'the billing one')
    expect(container.textContent).toContain('No matching workflows')
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Submit answer"]')?.click()
    })
    expect(onSelect).toHaveBeenCalledWith(
      'Which workflow should I improve? — the billing one',
      undefined
    )
  })

  it('carries only the picked resources through a mixed multi-step card', () => {
    const onSelect = vi.fn<InteractionAnswerHandler>()
    const confirm: QuestionItem = {
      type: 'single_select',
      prompt: 'Deploy after the change?',
      options: [
        { id: 'yes', label: 'Yes' },
        { id: 'no', label: 'No' },
      ],
    }
    render([PICK_WORKFLOW, confirm], onSelect)
    clickRow('Workflow 2')
    clickRow('No')

    expect(onSelect).toHaveBeenCalledWith(
      'Which workflow should I improve? — Workflow 2\nDeploy after the change? — No',
      [{ kind: 'workflow', workflowId: 'wf-2', label: 'Workflow 2' }]
    )
  })

  it('renders the answered recap from the transcript', () => {
    act(() => {
      root.render(<QuestionDisplay data={[PICK_WORKFLOW]} answers={['Workflow 3']} />)
    })
    expect(container.textContent).toContain('Which workflow should I improve?')
    expect(container.textContent).toContain('Workflow 3')
    expect(rowLabels()).toEqual([])
  })
})
