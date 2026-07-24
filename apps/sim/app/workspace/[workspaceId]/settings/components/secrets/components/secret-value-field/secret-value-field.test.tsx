/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SecretValueField } from './secret-value-field'

vi.mock('@sim/emcn', () => ({
  ChipInput: (props: ComponentProps<'input'>) => <input {...props} />,
}))

describe('SecretValueField', () => {
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

  it('keeps editable plaintext out of the DOM until focus', () => {
    act(() => root.render(<SecretValueField value='private-value' onChange={() => undefined} />))
    const input = container.querySelector('input')
    expect(input).not.toBeNull()
    expect(input?.type).toBe('text')
    expect(input?.value).toBe('••••••••••')

    act(() => input?.focus())
    expect(input?.type).toBe('text')
    expect(input?.value).toBe('private-value')

    act(() => input?.blur())
    expect(input?.type).toBe('text')
    expect(input?.value).toBe('••••••••••')
  })

  it('uses a fixed mask for viewers regardless of secret length', () => {
    act(() => root.render(<SecretValueField value='short' canEdit={false} />))
    const input = container.querySelector('input')
    expect(input?.value).toBe('••••••••••')

    act(() => root.render(<SecretValueField value='a-much-longer-private-value' canEdit={false} />))
    expect(input?.value).toBe('••••••••••')
  })
})
