/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CopyCodeButton } from './copy-code-button'

describe('CopyCodeButton', () => {
  it.each(['default', 'code-header'] as const)(
    'names the icon-only button in the %s appearance',
    (appearance) => {
      const markup = renderToStaticMarkup(<CopyCodeButton code='example' appearance={appearance} />)

      expect(markup).toContain('aria-label="Copy code"')
      expect(markup).toContain('type="button"')
    }
  )

  it('copies code, swaps to the check icon, and keeps its accessible name', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const writeText = vi.fn().mockResolvedValue(undefined)
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(<CopyCodeButton code='example' appearance='code-header' />)
      })
      const button = host.querySelector('button')
      expect(button?.getAttribute('aria-label')).toBe('Copy code')
      expect(button?.querySelector('svg rect')).not.toBeNull()

      await act(async () => {
        button?.click()
      })

      expect(writeText).toHaveBeenCalledExactlyOnceWith('example')
      expect(button?.querySelector('svg rect')).toBeNull()
      expect(button?.querySelector('svg path')).not.toBeNull()
      expect(button?.getAttribute('aria-label')).toBe('Copy code')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  })
})
