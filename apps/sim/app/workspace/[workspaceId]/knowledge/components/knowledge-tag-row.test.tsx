/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeTagRow } from './knowledge-tag-row'

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

describe('KnowledgeTagRow actions', () => {
  it('keeps activation and removal as separate keyboard-accessible buttons', () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const onActivate = vi.fn()
    const onRemove = vi.fn()

    act(() =>
      root?.render(
        <KnowledgeTagRow
          name='Customer'
          typeLabel='Text'
          detail='3 documents'
          activateLabel='View documents for Customer'
          removeLabel='Delete Customer'
          onActivate={onActivate}
          onRemove={onRemove}
        />
      )
    )

    const buttons = container.querySelectorAll('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0].contains(buttons[1])).toBe(false)
    expect(buttons[0].getAttribute('type')).toBe('button')
    expect(buttons[0].getAttribute('aria-label')).toBe('View documents for Customer')
    expect(buttons[1].getAttribute('aria-label')).toBe('Delete Customer')

    act(() => buttons[0].click())
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onRemove).not.toHaveBeenCalled()

    act(() => buttons[1].click())
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledTimes(1)
  })
})
