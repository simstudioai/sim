/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  ChipInput: (props: ComponentProps<'input'>) => <input {...props} />,
}))

import { SecretValueField } from '@/app/workspace/[workspaceId]/settings/components/secrets/components/secret-value-field/secret-value-field'

let container: HTMLDivElement
let root: Root

function input(): HTMLInputElement {
  const field = container.querySelector('input')
  if (!field) throw new Error('Secret value field did not render')
  return field
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('SecretValueField', () => {
  it('lets a read-only viewer reveal an allowed value without making it editable', () => {
    act(() => root.render(<SecretValueField value='visible-secret' canEdit={false} canReveal />))

    expect(input().readOnly).toBe(true)
    expect(input().style.webkitTextSecurity).toBe('disc')

    act(() => input().focus())

    expect(input().value).toBe('visible-secret')
    expect(input().readOnly).toBe(true)
    expect(input().style.webkitTextSecurity).toBe('')
  })

  it('never places a withheld value in the field', () => {
    act(() => root.render(<SecretValueField value='hidden-secret' canEdit={false} />))

    expect(input().value).toBe('•'.repeat(10))
    act(() => input().focus())
    expect(input().value).toBe('•'.repeat(10))
  })
})
