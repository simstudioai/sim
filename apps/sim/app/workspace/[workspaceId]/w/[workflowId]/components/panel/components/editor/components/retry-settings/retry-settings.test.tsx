/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/short-input',
  () => ({
    ShortInput: ({
      config,
      value,
      onChange,
      disabled,
    }: {
      config: { id: string }
      value: string
      onChange: (value: string) => void
      disabled: boolean
    }) => (
      <input
        id={config.id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
    ),
  })
)

import { RetrySettings } from './retry-settings'

const policy = { enabled: true as const, maxTries: 5, waitBetweenTriesMs: 2000 }

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

function renderSettings(props: Partial<Parameters<typeof RetrySettings>[0]> = {}) {
  const onChange = vi.fn()
  act(() => {
    root.render(
      <RetrySettings
        blockId='block-1'
        retry={policy}
        disabled={false}
        onChange={onChange}
        {...props}
      />
    )
  })
  return { onChange }
}

const field = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)

describe('RetrySettings', () => {
  it('leaves a configured value alone when the field is blurred untouched', () => {
    const { onChange } = renderSettings()
    const maxTries = field('block-retry-max-tries')!
    expect(maxTries.value).toBe('5')

    act(() => {
      maxTries.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })

    expect(onChange).not.toHaveBeenCalled()
    expect(field('block-retry-max-tries')!.value).toBe('5')
  })

  it('keeps only digits while typing and commits the value on blur', () => {
    const { onChange } = renderSettings()
    const maxTries = field('block-retry-max-tries')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!

    act(() => {
      setValue.call(maxTries, '<2')
      maxTries.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(field('block-retry-max-tries')!.value).toBe('2')

    act(() => {
      maxTries.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })

    expect(onChange).toHaveBeenCalledWith({ ...policy, maxTries: 2 })
  })

  it('renders only the switch while retry is off', () => {
    renderSettings({ retry: { ...policy, enabled: false } })

    expect(field('block-retry-enabled')).not.toBeNull()
    expect(field('block-retry-max-tries')).toBeNull()
  })
})
