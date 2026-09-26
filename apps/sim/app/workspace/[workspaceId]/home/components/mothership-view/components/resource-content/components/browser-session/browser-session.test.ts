/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserPermissionModal,
  claimPermissionResponse,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-session'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(ui: ReactNode): void {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(ui))
}

function rerender(ui: ReactNode): void {
  act(() => root?.render(ui))
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === text
  )
  if (!button) throw new Error(`No button labeled "${text}" rendered`)
  return button
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('claimPermissionResponse', () => {
  it('allows one response per request id across effect recreation', () => {
    const handledRequestIds = { current: new Set<string>() }

    expect(claimPermissionResponse(handledRequestIds, 'request-1')).toBe(true)
    expect(claimPermissionResponse(handledRequestIds, 'request-1')).toBe(false)
    expect(claimPermissionResponse(handledRequestIds, 'request-2')).toBe(true)
    expect(claimPermissionResponse(handledRequestIds, 'request-1')).toBe(false)
  })
})

describe('browser permission prompt', () => {
  const siteRequest = {
    requestId: 'site-request-1',
    tabId: 'tab-1',
    origin: 'https://outside.example',
  }
  const mediaRequest = {
    requestId: 'media-request-1',
    origin: 'https://meeting.example',
    devices: ['microphone', 'camera'] as const,
  }

  it('blocks replaced and unmounted requests once without overriding an explicit answer', () => {
    const handledRequestIds = { current: new Set<string>() }
    const responses = vi.fn()
    const onDecision = (
      requestId: string,
      action: 'respond-media-permission' | 'respond-site-permission',
      allowed: boolean
    ) => {
      if (claimPermissionResponse(handledRequestIds, requestId)) {
        responses(requestId, action, allowed)
      }
    }

    mount(
      createElement(BrowserPermissionModal, {
        request: siteRequest,
        open: true,
        onDecision,
      })
    )
    rerender(
      createElement(BrowserPermissionModal, {
        request: mediaRequest,
        open: true,
        onDecision,
      })
    )

    expect(responses).toHaveBeenCalledWith(siteRequest.requestId, 'respond-site-permission', false)
    act(() => buttonByText('Allow').click())
    act(() => root?.unmount())
    root = null

    expect(responses).toHaveBeenCalledTimes(2)
    expect(responses).toHaveBeenLastCalledWith(
      mediaRequest.requestId,
      'respond-media-permission',
      true
    )
  })
})
