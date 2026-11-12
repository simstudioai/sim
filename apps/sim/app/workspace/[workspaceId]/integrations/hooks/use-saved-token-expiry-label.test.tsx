/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSavedTokenExpiryLabel } from '@/app/workspace/[workspaceId]/integrations/hooks/use-saved-token-expiry-label'

const NOW = Date.parse('2026-11-11T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

let container: HTMLDivElement
let root: Root
let label: string | undefined

function Harness({ expiresAt }: { expiresAt?: string }) {
  label = useSavedTokenExpiryLabel(expiresAt)
  return null
}

function mount(expiresAt?: string) {
  act(() => {
    root.render(<Harness expiresAt={expiresAt} />)
  })
}

describe('useSavedTokenExpiryLabel', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW })
    container = document.createElement('div')
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    vi.useRealTimers()
  })

  it('reads expired once the token expires while the page stays open', () => {
    mount(new Date(NOW + 60_000).toISOString())
    expect(label).toBe('expires in 1 day')
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(label).toBe('expired')
  })

  it('counts the days down while the page stays open', () => {
    mount(new Date(NOW + 2 * DAY_MS).toISOString())
    expect(label).toBe('expires in 2 days')
    act(() => {
      vi.advanceTimersByTime(DAY_MS + 1)
    })
    expect(label).toBe('expires in 1 day')
  })

  it('has no caption for a token that states no expiry', () => {
    mount(undefined)
    expect(label).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })
})
