/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', async () => {
  const messages = (await import('@/messages/en/auto.json')).default as Record<string, string>
  return {
    useTranslations: () => (key: string) => messages[key] ?? key,
  }
})

vi.mock('@sim/emcn', () => ({
  Button: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => (
    <button {...props}>{children}</button>
  ),
}))

vi.mock('@/app/workspace/[workspaceId]/components', async () => {
  const errorModule = await import('@/app/workspace/[workspaceId]/components/error')
  return errorModule
})

import LogsError from './error'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  act(() => {
    root = createRoot(container)
  })
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function findButtonByText(text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(
    (el) => el.textContent?.trim() === text
  )
  if (!button) throw new Error(`Button with text "${text}" not found`)
  return button as HTMLButtonElement
}

describe('LogsError boundary', () => {
  it('renders the title and description from the shared ErrorState', () => {
    const error = Object.assign(new Error('boom'), { digest: 'abc123' })

    act(() => {
      root.render(<LogsError error={error} reset={vi.fn()} />)
    })

    expect(container.textContent).toContain('Failed to load logs')
    expect(container.textContent).toContain(
      'Something went wrong while loading the logs. Please try again.'
    )
  })

  it('calls reset when the refresh action is clicked', () => {
    const reset = vi.fn()
    const error = Object.assign(new Error('boom'), { digest: 'abc123' })

    act(() => {
      root.render(<LogsError error={error} reset={reset} />)
    })

    act(() => {
      findButtonByText('Refresh').click()
    })

    expect(reset).toHaveBeenCalledTimes(1)
  })
})
