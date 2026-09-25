/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EChartsView } from '@/components/charts/echarts-view'

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  setOption: vi.fn(),
  dispose: vi.fn(),
  disconnect: vi.fn(),
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
        disconnect = mocks.disconnect
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
    vi.resetAllMocks()
    vi.unstubAllGlobals()
  })

  it('updates data on the existing chart without a loading screen or disposal', async () => {
    await render(38)
    await vi.waitFor(() => expect(mocks.init).toHaveBeenCalledTimes(1))
    await render(12)
    expect(mocks.init).toHaveBeenCalledTimes(1)
    expect(mocks.dispose).not.toHaveBeenCalled()
    expect(mocks.setOption).toHaveBeenLastCalledWith(
      { series: [{ data: [12] }] },
      { notMerge: true }
    )
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it('uses the latest data when the font finishes loading after a range change', async () => {
    let finishFont!: () => void
    mocks.fontLoad.mockReturnValue(
      new Promise<void>((resolve) => {
        finishFont = resolve
      })
    )
    await render(38)
    await render(12)
    await act(async () => finishFont())
    expect(mocks.setOption).toHaveBeenCalledTimes(1)
    expect(mocks.setOption).toHaveBeenLastCalledWith(
      { series: [{ data: [12] }] },
      { notMerge: true }
    )
  })

  it('reports update failures and recovers on a later valid option', async () => {
    await render(38)
    mocks.setOption.mockImplementationOnce(() => {
      throw new Error('Invalid chart option')
    })
    await render(12)
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Invalid chart option')
    await render(6)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(mocks.init).toHaveBeenCalledTimes(1)
  })

  it('recreates the chart for a theme change and cleans up its observer', async () => {
    await render(38)
    mocks.theme = 'dark'
    await render(38)
    expect(mocks.init).toHaveBeenCalledTimes(2)
    expect(mocks.dispose).toHaveBeenCalledTimes(1)
    expect(mocks.disconnect).toHaveBeenCalledTimes(1)
  })

  it('rebinds interaction handlers when the timezone changes without replacing the canvas', async () => {
    const dispose = vi.fn()
    const prepareOption = vi.fn((option) => option)
    const createController = vi.fn(() => ({ prepareOption, afterUpdate: vi.fn(), dispose }))
    await act(async () =>
      root.render(
        <EChartsView
          label='Reports'
          option={{}}
          revision='UTC'
          createController={createController}
        />
      )
    )
    await act(async () =>
      root.render(
        <EChartsView
          label='Reports'
          option={{}}
          revision='America/Los_Angeles'
          createController={createController}
        />
      )
    )
    expect(mocks.init).toHaveBeenCalledTimes(1)
    expect(mocks.dispose).not.toHaveBeenCalled()
    expect(prepareOption).toHaveBeenCalledTimes(2)
    expect(dispose).toHaveBeenCalledTimes(1)
    await act(async () => root.render(null))
    expect(dispose).toHaveBeenCalledTimes(2)
  })
})
