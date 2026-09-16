/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { domAnimation, LazyMotion } from 'framer-motion'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockPreview } from '@/components/workflow-preview/block-preview'
import { DocsBlockNode } from '@/components/workflow-preview/docs-block-node'
import { DocsContainerNode } from '@/components/workflow-preview/docs-container-node'
import { PreviewSelectionContext } from '@/components/workflow-preview/preview-selection-context'
import type { PreviewWorkflow } from '@/components/workflow-preview/workflow-data'
import { WorkflowPreview } from '@/components/workflow-preview/workflow-preview'

const NODE_PROPS = {
  dragging: false,
  isConnectable: false,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
  selected: false,
  selectable: false,
  deletable: false,
  draggable: false,
  zIndex: 0,
}

const WORKFLOW: PreviewWorkflow = {
  id: 'keyboard-preview',
  name: 'Classify a lead',
  blocks: [
    {
      id: 'classify',
      name: 'Classify',
      type: 'function',
      typeLabel: 'Function',
      sentence: ['Run', { subBlockId: 'Code' }],
      bgColor: '#333333',
      rows: [{ title: 'Code', value: 'return "qualified"' }],
      position: { x: 0, y: 0 },
    },
  ],
  edges: [],
}

let host: HTMLDivElement
let root: Root
let previousBodyOverflow: string
let previousFocus: HTMLElement | null
const originalDialogMethods = {
  showModal: HTMLDialogElement.prototype.showModal,
  close: HTMLDialogElement.prototype.close,
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }))
  previousBodyOverflow = document.body.style.overflow
  previousFocus = null
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    this.open = true
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    if (!this.open) return
    this.open = false
    previousFocus?.focus()
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.style.overflow = previousBodyOverflow
  HTMLDialogElement.prototype.showModal = originalDialogMethods.showModal
  HTMLDialogElement.prototype.close = originalDialogMethods.close
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function render(children: ReactNode) {
  act(() => root.render(children))
}

function activate(element: HTMLElement, key: string) {
  element.focus()
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  act(() => element.dispatchEvent(event))
  return event
}

describe('workflow preview keyboard inspection', () => {
  it('uses shared sentence chips and the connected error port without exposing static controls', () => {
    render(
      <ReactFlowProvider>
        <LazyMotion features={domAnimation}>
          <DocsBlockNode
            {...NODE_PROPS}
            id='classify'
            type='previewBlock'
            data={{
              name: 'Classify',
              blockType: 'agent',
              typeLabel: 'Agent',
              bgColor: '#333333',
              rows: [
                { title: 'Model', value: 'claude-sonnet-4-6' },
                { title: 'System prompt', value: 'Full instructions stay in the inspector' },
              ],
              sentence: ['Prompt', { subBlockId: 'Model' }],
              hasErrorConnection: true,
            }}
          />
        </LazyMotion>
      </ReactFlowProvider>
    )
    expect(host.textContent).toContain('Prompt')
    expect(host.textContent).toContain('claude-sonnet-4-6')
    expect(host.textContent).not.toContain('Full instructions stay in the inspector')
    expect(host.querySelector('[data-handleid="error"]')).not.toBeNull()
    const errorSwitch = host.querySelector<HTMLElement>('[aria-label="On error branch"]')!
    expect(errorSwitch.getAttribute('aria-checked')).toBe('true')
    expect(errorSwitch.hasAttribute('disabled')).toBe(true)
  })

  it('keeps standalone block illustrations out of the keyboard tab order', () => {
    render(<BlockPreview type='function' />)
    const card = host.querySelector<HTMLElement>('.workflow-drag-handle')!
    expect(card).not.toBeNull()
    expect(card.hasAttribute('role')).toBe(false)
    expect(card.tabIndex).toBe(-1)
    expect(host.querySelector('.react-flow__node[tabindex="0"]')).toBeNull()
  })

  it('opens a normal block through the shared Enter and Space controls', () => {
    const selectBlock = vi.fn()
    render(
      <ReactFlowProvider>
        <PreviewSelectionContext value={selectBlock}>
          <LazyMotion features={domAnimation}>
            <DocsBlockNode
              {...NODE_PROPS}
              id='classify'
              type='previewBlock'
              data={{ name: 'Classify', blockType: 'function', bgColor: '#333333', rows: [] }}
            />
          </LazyMotion>
        </PreviewSelectionContext>
      </ReactFlowProvider>
    )
    const control = host.querySelector<HTMLElement>('.workflow-drag-handle[role="button"]')!
    expect(activate(control, 'Enter').defaultPrevented).toBe(true)
    expect(selectBlock).toHaveBeenNthCalledWith(1, 'classify')
    expect(activate(control, ' ').defaultPrevented).toBe(true)
    expect(selectBlock).toHaveBeenNthCalledWith(2, 'classify')
    expect(selectBlock).toHaveBeenCalledTimes(2)
    activate(control, 'ArrowDown')
    expect(selectBlock).toHaveBeenCalledTimes(2)
  })

  it.each([
    { name: 'Loop', blockType: 'loop' },
    { name: 'Candidates', blockType: 'parallel' },
  ])('opens the $blockType container through the same keyboard control', ({ name, blockType }) => {
    const selectBlock = vi.fn()
    render(
      <ReactFlowProvider>
        <PreviewSelectionContext value={selectBlock}>
          <DocsContainerNode
            {...NODE_PROPS}
            id='container'
            type='previewContainer'
            data={{ name, blockType, size: { width: 600, height: 300 } }}
          />
        </PreviewSelectionContext>
      </ReactFlowProvider>
    )
    const control = host.querySelector<HTMLElement>('[data-subflow-header]')!
    expect(activate(control, 'Enter').defaultPrevented).toBe(true)
    expect(activate(control, ' ').defaultPrevented).toBe(true)
    expect(selectBlock.mock.calls).toEqual([['container'], ['container']])
  })
})

describe('workflow preview modal lifecycle', () => {
  it('opens the selected block from the actual canvas keyboard control', () => {
    render(<WorkflowPreview workflow={WORKFLOW} />)
    const node = host.querySelector<HTMLElement>('.react-flow__node[data-id="classify"]')!
    expect(node.tabIndex).toBe(-1)
    const control = node.querySelector<HTMLElement>('.workflow-drag-handle[role="button"]')!
    activate(control, 'Enter')
    const dialog = host.querySelector<HTMLDialogElement>('dialog')!
    expect(dialog.open).toBe(true)
    expect(dialog.querySelector('button[aria-pressed="true"]')?.textContent).toBe('Classify')
    expect(dialog.textContent).toContain('return "qualified"')
  })

  it('locks scrolling, focuses Close, and handles the native Escape cancel event', () => {
    document.body.style.overflow = 'clip'
    render(<WorkflowPreview workflow={WORKFLOW} />)
    const expand = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand Classify a lead workflow preview"]'
    )!
    expand.focus()
    act(() => expand.click())
    const dialog = host.querySelector<HTMLDialogElement>('dialog')!
    expect(dialog.open).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.activeElement).toBe(dialog.querySelector('button[aria-label="Close"]'))
    const cancel = new Event('cancel', { cancelable: true })
    act(() => dialog.dispatchEvent(cancel))
    expect(cancel.defaultPrevented).toBe(true)
    expect(dialog.open).toBe(false)
    expect(document.body.style.overflow).toBe('clip')
    expect(document.activeElement).toBe(expand)
  })

  it('restores the existing scroll policy when an open preview unmounts', () => {
    document.body.style.overflow = 'auto'
    render(<WorkflowPreview workflow={WORKFLOW} />)
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label^="Expand "]')!.click())
    expect(document.body.style.overflow).toBe('hidden')
    render(null)
    expect(document.body.style.overflow).toBe('auto')
  })
})
