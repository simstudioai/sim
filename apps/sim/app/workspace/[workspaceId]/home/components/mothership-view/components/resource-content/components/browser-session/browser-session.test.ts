/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import {
  browserPanelSnapshotStyle,
  browserSelectionContext,
  clearOmniboxSelection,
  resolveUrlBarInput,
  selectFocusedOmniboxOnNextFrame,
  shouldRemoveBrowserResource,
  shouldReportBrowserBounds,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-session'

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
