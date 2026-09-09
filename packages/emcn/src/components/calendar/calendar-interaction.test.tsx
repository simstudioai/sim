/**
 * @vitest-environment jsdom
 */

import { act, createElement } from 'react'
import { Calendar } from '@sim/emcn'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('Calendar precise date edits', () => {
  it.each(['07:30:45.123456', '00:00:00.000001', '02:30:00.999999'])(
    'retains %s when selecting a day and Today',
    async (time) => {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)
      const onChange = vi.fn()
      try {
        await act(async () =>
          root.render(
            createElement(Calendar, {
              value: `2026-03-07T${time}`,
              showTime: true,
              today: '2026-03-09',
              onChange,
            })
          )
        )
        const buttons = Array.from(container.querySelectorAll('button'))
        const nextDay = buttons.find((button) => button.textContent?.trim() === '8')
        expect(nextDay).toBeDefined()
        await act(async () => nextDay!.click())
        expect(onChange).toHaveBeenLastCalledWith(`2026-03-08T${time}`)
        const today = buttons.find((button) => button.textContent?.trim() === 'Today')
        expect(today).toBeDefined()
        await act(async () => today!.click())
        expect(onChange).toHaveBeenLastCalledWith(`2026-03-09T${time}`)
      } finally {
        await act(async () => root.unmount())
        container.remove()
      }
    }
  )
})
