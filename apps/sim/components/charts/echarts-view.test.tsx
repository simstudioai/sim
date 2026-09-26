/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EChartsView } from '@/components/charts/echarts-view'

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  setOption: vi.fn(),
  dispose: vi.fn(),
  fontLoad: vi.fn(),
  theme: 'light',
}))
vi.mock('echarts', () => ({ init: mocks.init, use: vi.fn() }))
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: mocks.theme }) }))
vi.mock('@/lib/charts/theme', () => ({
  readEmcnChartTheme: () => ({}),
  applyChartTooltipDefaults: (option: unknown) => option,
}))

describe('EChartsView updates', () => {
  let root: Root
  let container: HTMLDivElement

  async function render(value: number) {
    await act(async () => {
      root.render(<EChartsView label='Reports' option={{ series: [{ data: [value] }] }} />)
    })
  }

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load: mocks.fontLoad },
    })
    mocks.fontLoad.mockResolvedValue([])
    mocks.theme = 'light'
    mocks.init.mockReturnValue({
      setOption: mocks.setOption,
      dispose: mocks.dispose,
      resize: vi.fn(),
    })
    container = document.createElement('div')
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
  })

  it('updates data without replacing the chart with a loading screen', async () => {
    await render(38)
    await vi.waitFor(() => expect(container.querySelector('[role="status"]')).toBeNull())
    await render(12)
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it('reports update failures and recovers on a later valid option', async () => {
    await render(38)
    mocks.setOption.mockImplementationOnce(() => {
      throw new Error('Invalid chart option')
    })
    await render(12)
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    await render(6)
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})
