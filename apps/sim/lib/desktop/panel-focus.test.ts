/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { trackPanelFocus } from '@/lib/desktop/panel-focus'

describe('trackPanelFocus', () => {
  it('follows interaction and releases focus outside the panel or on cleanup', () => {
    const panel = document.createElement('div')
    const panelButton = document.createElement('button')
    const outsideButton = document.createElement('button')
    panel.appendChild(panelButton)
    document.body.append(panel, outsideButton)
    const reportFocus = vi.fn()

    const cleanup = trackPanelFocus(panel, reportFocus)
    // Appearing is not a claim: the agent opens these panels on the user's
    // behalf, so a Cmd-W aimed at the chat must not reach a panel they have
    // not touched.
    expect(reportFocus).not.toHaveBeenCalled()

    panelButton.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(reportFocus).toHaveBeenLastCalledWith(true)

    outsideButton.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(reportFocus).toHaveBeenLastCalledWith(false)

    panelButton.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(reportFocus).toHaveBeenLastCalledWith(true)

    cleanup()
    expect(reportFocus).toHaveBeenLastCalledWith(false)
    reportFocus.mockClear()
    panelButton.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(reportFocus).not.toHaveBeenCalled()

    panel.remove()
    outsideButton.remove()
  })

  /**
   * The regression that motivated hoisting this out of the browser panel: a
   * panel with N children must report as ONE owner. Two trackers over the same
   * shell flag mean the second one's cleanup erases the first one's live claim,
   * which is what let Cmd-W fall through to closing the window.
   */
  it('keeps the panel claim when a sibling tracker over the same panel tears down', () => {
    const panel = document.createElement('div')
    const panelButton = document.createElement('button')
    panel.appendChild(panelButton)
    document.body.append(panel)
    let focused = false
    const reportFocus = (next: boolean) => {
      focused = next
    }

    const cleanup = trackPanelFocus(panel, reportFocus)
    panelButton.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(focused).toBe(true)

    // One tracker per panel: the only teardown that drops the claim is the
    // panel's own.
    cleanup()
    expect(focused).toBe(false)

    panel.remove()
  })

  /**
   * The terminal panel is opened FOR the user by the agent, so merely
   * appearing must not claim the accelerator: a Cmd-W aimed at the chat would
   * close a shell the user never touched. It has a real signal to wait for —
   * xterm focuses its textarea once the panel is on screen.
   */
  it('waits for real interaction before claiming, unless told to claim on appear', () => {
    const panel = document.createElement('div')
    const panelButton = document.createElement('button')
    panel.appendChild(panelButton)
    document.body.append(panel)
    const reportFocus = vi.fn()

    const cleanup = trackPanelFocus(panel, reportFocus)
    expect(reportFocus).not.toHaveBeenCalled()

    panelButton.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(reportFocus).toHaveBeenLastCalledWith(true)

    cleanup()
    panel.remove()
  })
})
