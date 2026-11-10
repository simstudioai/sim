/**
 * @vitest-environment jsdom
 *
 * Failure modes: a panel the agent opened claims Cmd-W before the user touches it, a click outside
 * leaves the claim held, a torn-down panel keeps its claim, and a panel the user was typing in
 * loses it for good after the window blurs and refocuses.
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

  it('reclaims a focused panel after its window loses and regains focus', () => {
    const panel = document.createElement('div')
    const terminalInput = document.createElement('textarea')
    panel.appendChild(terminalInput)
    document.body.append(panel)
    const reportFocus = vi.fn()

    const cleanup = trackPanelFocus(panel, reportFocus)
    terminalInput.focus()
    expect(document.activeElement).toBe(terminalInput)
    expect(reportFocus).toHaveBeenLastCalledWith(true)

    window.dispatchEvent(new Event('blur'))
    expect(document.activeElement).toBe(terminalInput)
    expect(reportFocus).toHaveBeenLastCalledWith(false)

    window.dispatchEvent(new Event('focus'))
    expect(reportFocus).toHaveBeenLastCalledWith(true)
    expect(reportFocus.mock.calls).toEqual([[true], [false], [true]])

    cleanup()
    panel.remove()
  })
})
