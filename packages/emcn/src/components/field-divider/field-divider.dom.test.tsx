/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FieldDisclosure } from './field-divider'

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('FieldDisclosure', () => {
  it('leaves expansion to the caller and does not submit its surrounding form', () => {
    const onClick = vi.fn()
    const onSubmit = vi.fn((event) => event.preventDefault())
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const render = (expanded: boolean, disabled = false) => (
      <form onSubmit={onSubmit}>
        <FieldDisclosure
          expanded={expanded}
          disabled={disabled}
          onClick={onClick}
          aria-controls='additional-fields'
        >
          {expanded ? 'Hide additional fields' : 'Show additional fields'}
        </FieldDisclosure>
        <div id='additional-fields' hidden={!expanded}>
          Additional fields
        </div>
      </form>
    )
    act(() => root?.render(render(false)))
    const button = container.querySelector('button')!
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-controls')).toBe('additional-fields')
    act(() => {
      button.focus()
      button.click()
    })
    expect(document.activeElement).toBe(button)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(button.getAttribute('aria-expanded')).toBe('false')

    act(() => root?.render(render(true)))
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.textContent).toBe('Hide additional fields')
    expect(container.querySelector<HTMLElement>('#additional-fields')?.hidden).toBe(false)

    act(() => root?.render(render(true, true)))
    act(() => button.click())
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
