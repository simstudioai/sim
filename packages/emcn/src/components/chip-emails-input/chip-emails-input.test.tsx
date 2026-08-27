/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChipEmailsInput } from './chip-emails-input'

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

it('commits a multi-email paste with one state callback', () => {
  const onChange = vi.fn()
  act(() => root.render(<ChipEmailsInput value={[]} onChange={onChange} />))
  const input = host.querySelector('input') as HTMLInputElement
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: () => 'one@example.com two@example.com three@example.com' },
  })

  act(() => input.dispatchEvent(event))

  expect(onChange).toHaveBeenCalledOnce()
  expect(onChange).toHaveBeenCalledWith(['one@example.com', 'two@example.com', 'three@example.com'])
})
