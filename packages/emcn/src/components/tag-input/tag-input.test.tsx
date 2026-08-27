/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TagInput } from './tag-input'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

it('deduplicates and sends a paste through one batch callback', () => {
  const onAdd = vi.fn(() => true)
  const onAddMany = vi.fn()
  act(() => {
    root.render(<TagInput items={[]} onAdd={onAdd} onAddMany={onAddMany} onRemove={vi.fn()} />)
  })
  const input = host.querySelector('input') as HTMLInputElement
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: () => 'one@example.com, two@example.com one@example.com' },
  })

  act(() => input.dispatchEvent(event))

  expect(onAddMany).toHaveBeenCalledOnce()
  expect(onAddMany).toHaveBeenCalledWith(['one@example.com', 'two@example.com'])
  expect(onAdd).not.toHaveBeenCalled()
})
