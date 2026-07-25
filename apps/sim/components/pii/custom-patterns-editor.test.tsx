/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomPatternsEditor } from '@/components/pii/custom-patterns-editor'
import type { CustomPiiPattern } from '@/lib/guardrails/pii-entities'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function row(regex: string): CustomPiiPattern {
  return { name: 'X', regex, replacement: '<X>' }
}

function renderEditor(patterns: CustomPiiPattern[], onChange: (p: CustomPiiPattern[]) => void) {
  act(() => root.render(<CustomPatternsEditor patterns={patterns} onChange={onChange} />))
}

function clickText(text: string) {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent === text)
  if (!button) throw new Error(`button "${text}" not found`)
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

describe('CustomPatternsEditor', () => {
  it('renders one input row per pattern with no error for a valid regex', () => {
    renderEditor([row('EMP-\\d{6}')], vi.fn())
    const values = [...container.querySelectorAll('input')].map((i) => i.value)
    expect(values).toContain('EMP-\\d{6}')
    expect(container.textContent).not.toMatch(/Invalid regex/)
    expect(container.textContent).not.toMatch(/potentially unsafe/)
  })

  it('shows an inline error for a syntactically invalid regex', () => {
    renderEditor([row('(')], vi.fn())
    expect(container.textContent).toMatch(/Invalid regex/)
  })

  it('shows an inline error for a catastrophic-backtracking pattern', () => {
    renderEditor([row('(a+)+$')], vi.fn())
    expect(container.textContent).toMatch(/potentially unsafe/)
  })

  it('appends an empty row when "Add pattern" is clicked', () => {
    const onChange = vi.fn()
    renderEditor([row('a+')], onChange)
    clickText('Add pattern')
    expect(onChange).toHaveBeenCalledWith([
      { name: 'X', regex: 'a+', replacement: '<X>' },
      { name: '', regex: '', replacement: '' },
    ])
  })

  it('removes a row when its remove button is clicked', () => {
    const onChange = vi.fn()
    renderEditor([row('a+'), row('b+')], onChange)
    const remove = container.querySelector(
      'button[aria-label="Remove pattern"]'
    ) as HTMLButtonElement
    act(() => remove.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onChange).toHaveBeenCalledWith([{ name: 'X', regex: 'b+', replacement: '<X>' }])
  })
})
