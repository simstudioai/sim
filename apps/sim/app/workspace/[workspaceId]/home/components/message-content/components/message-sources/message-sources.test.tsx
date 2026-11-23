/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { flushMacrotask } from '@sim/testing/helpers/async'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimLinkOrganizationProvider } from '@/app/o/[organizationId]/links/sim-link-organization-provider'
import { MessageSources } from '@/app/workspace/[workspaceId]/home/components/message-content/components/message-sources/message-sources'

const source = { url: 'https://docs.example.test/guide', title: 'Setup guide' }

/** Radix menus open on a primary-button pointer press, which jsdom's click() does not send. */
function press(element: Element | null) {
  if (!element) throw new Error('Expected an element to press')
  element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
}

async function settle() {
  await act(flushMacrotask)
}

describe('creating a Sim link from the sources popover', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ links: [], nextCursor: null }))
    )
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <SimLinkOrganizationProvider organizationId='org-1'>
            <MessageSources sources={[source]} />
          </SimLinkOrganizationProvider>
        </QueryClientProvider>
      )
    )
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('opens the form outside the popover and dismisses the popover, so the form is never beneath it', async () => {
    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="1 source"]')?.click())
    const row = () => document.querySelector(`a[href="${source.url}"]`)
    expect(row()).not.toBeNull()

    act(() => press(document.querySelector(`[aria-label="Actions for ${source.title}"]`)))
    await settle()
    const create = [...document.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === 'Create link'
    )
    if (!(create instanceof HTMLElement)) throw new Error('Expected a Create link item')
    expect(create.getAttribute('aria-disabled')).not.toBe('true')
    act(() => create.click())
    await settle()

    const form = [...document.querySelectorAll('[role="dialog"]')].find((dialog) =>
      dialog.textContent?.includes('New link')
    )
    expect(form).toBeDefined()
    expect(document.querySelector<HTMLInputElement>('input[type="url"]')?.value).toBe(source.url)
    expect(row()).toBeNull()
  })
})
