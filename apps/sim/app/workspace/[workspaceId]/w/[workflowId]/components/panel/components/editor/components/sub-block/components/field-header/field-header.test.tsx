/**
 * @vitest-environment jsdom
 */
import { act, createRef } from 'react'
import { Tooltip } from '@sim/emcn'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SubBlockFieldHeader } from './field-header'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(header: React.ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<Tooltip.Provider>{header}</Tooltip.Provider>))
}

describe('SubBlockFieldHeader', () => {
  afterEach(() => {
    if (root) act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
  })

  it('renders required and validation state with canonical actions', () => {
    const onCopy = vi.fn()
    const onToggle = vi.fn()
    mount(
      <SubBlockFieldHeader
        title='Response format'
        required
        invalidJson
        copyAction={{ copied: false, onCopy }}
        canonicalAction={{ mode: 'basic', onToggle }}
      />
    )

    expect(container?.textContent).toContain('Response format')
    expect(container?.querySelector('[aria-label="Required"]')).not.toBeNull()
    expect(container?.querySelector('[aria-label="Switch to manual ID"]')).not.toBeNull()

    const copyButton = container?.querySelector<HTMLButtonElement>('[aria-label="Copy value"]')
    if (!copyButton) throw new Error('Copy action did not render')
    act(() => copyButton.click())
    expect(onCopy).toHaveBeenCalledOnce()
  })

  it('submits and cancels the inline generation prompt from the keyboard', () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    mount(
      <SubBlockFieldHeader
        title='Prompt'
        wandAction={{
          isSearchActive: true,
          searchQuery: 'Summarize this',
          isStreaming: false,
          onSearchClick: vi.fn(),
          onSearchBlur: vi.fn(),
          onSearchChange: vi.fn(),
          onSearchSubmit: onSubmit,
          onSearchCancel: onCancel,
          searchInputRef: createRef<HTMLInputElement>(),
        }}
      />
    )

    const input = container?.querySelector<HTMLInputElement>('[aria-label="Generate with AI"]')
    if (!input) throw new Error('Generation input did not render')
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    })

    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
