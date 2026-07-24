/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import {
  resolveUrlBarInput,
  selectFocusedOmniboxOnNextFrame,
  trackBrowserPanelFocus,
} from './browser-session'

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

describe('trackBrowserPanelFocus', () => {
  it('owns focus on mount, follows interaction, and releases it outside or on cleanup', () => {
    const panel = document.createElement('div')
    const panelButton = document.createElement('button')
    const outsideButton = document.createElement('button')
    panel.appendChild(panelButton)
    document.body.append(panel, outsideButton)
    const reportFocus = vi.fn()

    const cleanup = trackBrowserPanelFocus(panel, reportFocus)
    expect(reportFocus).toHaveBeenLastCalledWith(true)

    outsideButton.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(reportFocus).toHaveBeenLastCalledWith(false)

    panelButton.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(reportFocus).toHaveBeenLastCalledWith(true)

    cleanup()
    expect(reportFocus).toHaveBeenLastCalledWith(false)
    reportFocus.mockClear()
    panelButton.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(reportFocus).not.toHaveBeenCalled()

    panel.remove()
    outsideButton.remove()
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
