/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserPermissionModal,
  browserPanelSnapshotStyle,
  browserPermissionPrompt,
  browserPermissionResponseAction,
  browserSelectionContext,
  claimPermissionResponse,
  clearOmniboxSelection,
  exceededOmniboxDragThreshold,
  hasConfirmedBrowserTabCreation,
  initialUrlSuggestionIndex,
  resolveUrlBarInput,
  selectFocusedOmniboxOnNextFrame,
  shouldOpenUrlSuggestions,
  shouldRemoveBrowserResource,
  shouldReportBrowserBounds,
  shouldShowBrowserPermissionRequest,
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

function makeElementsVisible(): void {
  const rect = {
    bottom: 1,
    height: 1,
    left: 0,
    right: 1,
    top: 0,
    width: 1,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } satisfies DOMRect
  const rects = {
    0: rect,
    length: 1,
    item: (index: number) => (index === 0 ? rect : null),
    [Symbol.iterator]: function* () {
      yield rect
    },
  } as DOMRectList
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue(rects)
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.restoreAllMocks()
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

  it('keeps an answered hidden request closed when visible again and opens a new id', () => {
    expect(shouldShowBrowserPermissionRequest(siteRequest.requestId, null, false)).toBe(false)
    expect(
      shouldShowBrowserPermissionRequest(siteRequest.requestId, siteRequest.requestId, true)
    ).toBe(false)
    expect(shouldShowBrowserPermissionRequest('site-request-2', siteRequest.requestId, true)).toBe(
      true
    )
  })

  it('maps each request kind to its exact native response action', () => {
    expect(browserPermissionResponseAction(siteRequest)).toBe('respond-site-permission')
    expect(browserPermissionResponseAction(mediaRequest)).toBe('respond-media-permission')
  })

  it('describes the scope and consequence of site and media access', () => {
    expect(browserPermissionPrompt(siteRequest)).toEqual({
      title: 'Open another website?',
      text: expect.stringContaining('This page wants to open https://outside.example.'),
    })
    expect(browserPermissionPrompt(siteRequest).text).toContain('for the rest of this browser task')
    expect(browserPermissionPrompt(mediaRequest)).toEqual({
      title: 'Allow https://meeting.example to use your microphone and camera?',
      text: expect.stringContaining('until it navigates'),
    })
  })

  it('renders an accessible, fail-safe modal and makes Block an explicit decision', () => {
    makeElementsVisible()
    const onDecision = vi.fn()
    mount(
      createElement(BrowserPermissionModal, {
        request: siteRequest,
        open: true,
        onDecision,
      })
    )

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog).not.toBeNull()
    const labelledBy = dialog?.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(document.getElementById(labelledBy ?? '')?.textContent).toBe('Open another website?')
    expect(dialog?.textContent).toContain('https://outside.example')
    expect(dialog?.textContent).toContain('for the rest of this browser task')
    expect(document.querySelector('[data-native-surface-occlusion="modal"]')).not.toBeNull()
    expect(document.querySelector('[data-chip-modal-default-policy="dismiss"]')).not.toBeNull()
    expect(document.activeElement).toBe(buttonByText('Block'))

    act(() => buttonByText('Block').click())
    expect(onDecision).toHaveBeenCalledOnce()
    expect(onDecision).toHaveBeenCalledWith(siteRequest.requestId, 'respond-site-permission', false)
  })

  it('keeps long destinations in the wrapping body instead of the truncated title', () => {
    const origin = `https://${'a'.repeat(63)}.${'b'.repeat(63)}.example`
    mount(
      createElement(BrowserPermissionModal, {
        request: { ...siteRequest, origin },
        open: true,
        onDecision: vi.fn(),
      })
    )
    const dialog = document.querySelector('[role="dialog"]')
    const descriptionId = dialog?.getAttribute('aria-describedby')
    const description = document.getElementById(descriptionId ?? '')
    expect(description?.textContent).toContain(origin)
    expect(description?.classList.contains('break-words')).toBe(true)
  })

  it('makes Allow an explicit primary decision', () => {
    const onDecision = vi.fn()
    mount(
      createElement(BrowserPermissionModal, {
        request: mediaRequest,
        open: true,
        onDecision,
      })
    )

    const allow = buttonByText('Allow')
    expect(allow.className).toContain('bg-[var(--text-primary)]')
    act(() => allow.click())
    expect(onDecision).toHaveBeenCalledOnce()
    expect(onDecision).toHaveBeenCalledWith(
      mediaRequest.requestId,
      'respond-media-permission',
      true
    )
  })

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

describe('browserPanelSnapshotStyle', () => {
  const snapshot = {
    dataUrl: 'data:image/png;base64,c2lt',
    tabId: 'tab-1',
    zoomPercent: 100,
    scopeId: 'chat-1',
  }

  it('uses the exact native viewport rectangle without host clipping', () => {
    expect(
      browserPanelSnapshotStyle({
        ...snapshot,
        viewportBounds: { x: 500.5, y: 64, width: 799.5, height: 701.5 },
      })
    ).toEqual({
      position: 'fixed',
      top: 64,
      left: 500.5,
      width: 799.5,
      height: 701.5,
      maxWidth: 'none',
      zIndex: 'calc(var(--z-popover) - 1)',
    })
  })

  it('places modal replacements below the real modal backdrop', () => {
    expect(
      browserPanelSnapshotStyle(
        {
          ...snapshot,
          viewportBounds: { x: 500, y: 64, width: 800, height: 702 },
        },
        'modal'
      )
    ).toMatchObject({
      position: 'fixed',
      zIndex: 'calc(var(--z-modal) - 1)',
    })
  })

  it('falls back to host sizing for older installed shells', () => {
    expect(browserPanelSnapshotStyle(snapshot)).toBeUndefined()
  })
})

describe('browserSelectionContext', () => {
  it('keeps the exact selected text in a browser-tab mention', () => {
    expect(
      browserSelectionContext({
        text: '  selected\ntext  ',
        tabId: 'tab-1',
        url: 'https://example.com/docs',
        title: '  Example   docs  ',
        scopeId: 'chat-1',
      })
    ).toEqual({
      kind: 'browser_tab',
      tabId: 'tab-1',
      label: 'Browser',
      selection: {
        text: '  selected\ntext  ',
        url: 'https://example.com/docs',
        title: '  Example   docs  ',
      },
    })
  })
})

describe('resolveUrlBarInput', () => {
  it('passes explicit schemes through untouched', () => {
    expect(resolveUrlBarInput('https://sim.ai/docs')).toBe('https://sim.ai/docs')
    expect(resolveUrlBarInput('http://localhost:3000/workspace')).toBe(
      'http://localhost:3000/workspace'
    )
  })

  it('defaults host-looking input to https', () => {
    expect(resolveUrlBarInput('google.com')).toBe('https://google.com')
    expect(resolveUrlBarInput('docs.sim.ai/agents?tab=1')).toBe('https://docs.sim.ai/agents?tab=1')
  })

  it('defaults localhost and loopback IPs to http (local dev servers rarely speak TLS)', () => {
    expect(resolveUrlBarInput('localhost:3000')).toBe('http://localhost:3000')
    expect(resolveUrlBarInput('localhost')).toBe('http://localhost')
    expect(resolveUrlBarInput('127.0.0.1:8080/health')).toBe('http://127.0.0.1:8080/health')
  })

  it('treats non-URL input as a Google search', () => {
    expect(resolveUrlBarInput('best pizza near me')).toBe(
      'https://www.google.com/search?q=best%20pizza%20near%20me'
    )
    expect(resolveUrlBarInput('what is sim.ai pricing')).toBe(
      'https://www.google.com/search?q=what%20is%20sim.ai%20pricing'
    )
    expect(resolveUrlBarInput('electron')).toBe('https://www.google.com/search?q=electron')
  })
})

describe('selectFocusedOmniboxOnNextFrame', () => {
  it('waits for the focus click to settle and selects only while the input remains focused', () => {
    const callbacks: FrameRequestCallback[] = []
    const requestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callbacks.push(callback)
        return callbacks.length
      })
    const input = document.createElement('input')
    document.body.appendChild(input)
    const select = vi.spyOn(input, 'select')

    input.focus()
    selectFocusedOmniboxOnNextFrame(input)
    expect(select).not.toHaveBeenCalled()
    callbacks.shift()?.(0)
    expect(select).toHaveBeenCalledOnce()

    select.mockClear()
    selectFocusedOmniboxOnNextFrame(input)
    input.blur()
    callbacks.shift()?.(0)
    expect(select).not.toHaveBeenCalled()

    requestFrame.mockRestore()
    input.remove()
  })
})

describe('clearOmniboxSelection', () => {
  it('collapses a highlighted URL to a caret at the end of the selection', () => {
    const input = document.createElement('input')
    input.value = 'https://sim.ai'
    input.setSelectionRange(0, input.value.length)

    clearOmniboxSelection(input)

    expect(input.selectionStart).toBe(input.value.length)
    expect(input.selectionEnd).toBe(input.value.length)
  })
})

describe('exceededOmniboxDragThreshold', () => {
  it('preserves select-all through pointer jitter but cancels it for a drag', () => {
    expect(exceededOmniboxDragThreshold(100, 100, 103, 102)).toBe(false)
    expect(exceededOmniboxDragThreshold(100, 100, 105, 100)).toBe(true)
  })
})

describe('shouldOpenUrlSuggestions', () => {
  it('opens only once the renderer owns the painted frame', () => {
    expect(shouldOpenUrlSuggestions('suggestions', 3)).toBe(true)
  })

  it('stays closed while the native page is still on top', () => {
    // The rows are ranked and ready, but a click would land on the
    // WebContentsView rather than the list — the "clicking a suggestion does
    // nothing" bug. Not opening is the honest outcome; there is no native menu
    // to fall back to.
    expect(shouldOpenUrlSuggestions(null, 3)).toBe(false)
  })

  it('stays closed when another overlay holds the lease', () => {
    expect(shouldOpenUrlSuggestions('credentials', 3)).toBe(false)
    expect(shouldOpenUrlSuggestions('tab', 3)).toBe(false)
  })

  it('stays closed with nothing to suggest, however the frame is owned', () => {
    expect(shouldOpenUrlSuggestions('suggestions', 0)).toBe(false)
    expect(shouldOpenUrlSuggestions(null, 0)).toBe(false)
  })
})

describe('initialUrlSuggestionIndex', () => {
  it('selects the first suggestion on a new tab', () => {
    expect(initialUrlSuggestionIndex('', 3)).toBe(0)
    expect(initialUrlSuggestionIndex('about:blank', 3)).toBe(0)
  })

  it('leaves existing pages unselected so Enter submits the current URL', () => {
    expect(initialUrlSuggestionIndex('https://sim.ai', 3)).toBeNull()
  })

  it('selects the exact search row after typing on an existing page', () => {
    expect(initialUrlSuggestionIndex('https://sim.ai', 3, 'what is the best')).toBe(0)
  })

  it('selects nothing when there are no suggestions', () => {
    expect(initialUrlSuggestionIndex('', 0)).toBeNull()
  })
})

describe('hasConfirmedBrowserTabCreation', () => {
  it('requires both a larger strip and a distinct active tab', () => {
    expect(hasConfirmedBrowserTabCreation('tab-1', 1, 'tab-2', 2)).toBe(true)
    expect(hasConfirmedBrowserTabCreation('tab-1', 1, 'tab-1', 2)).toBe(false)
    expect(hasConfirmedBrowserTabCreation('tab-1', 1, 'tab-2', 1)).toBe(false)
    expect(hasConfirmedBrowserTabCreation('tab-1', 1, null, 2)).toBe(false)
  })
})

describe('suspended browser resource lifecycle', () => {
  it('does not remove a resource when administrative suspension clears its tabs', () => {
    expect(shouldRemoveBrowserResource(false, true, true)).toBe(false)
    expect(shouldRemoveBrowserResource(false, true, false)).toBe(true)
  })

  it('reports native bounds only while visible and unsuspended', () => {
    expect(shouldReportBrowserBounds(true, false)).toBe(true)
    expect(shouldReportBrowserBounds(true, true)).toBe(false)
    expect(shouldReportBrowserBounds(false, false)).toBe(false)
  })
})
