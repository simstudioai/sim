/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import { useMothershipHandoff } from '@/app/workspace/[workspaceId]/home/hooks/use-mothership-handoff'

const { mockQueryState } = vi.hoisted(() => ({
  mockQueryState: {
    value: null as string | null,
    setValue: vi.fn(),
  },
}))

vi.mock('nuqs', () => ({
  useQueryState: () => [mockQueryState.value, mockQueryState.setValue],
}))

const mockSendMessage = vi.fn(async () => {})

interface TestHarnessProps {
  renderKey: number
}

function TestHarness({ renderKey }: TestHarnessProps) {
  useMothershipHandoff({
    workspaceId: 'workspace-1',
    sendMessage: mockSendMessage,
  })
  return <span>{renderKey}</span>
}

describe('useMothershipHandoff', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear()
    mockQueryState.value = null
    mockQueryState.setValue.mockClear()
    mockSendMessage.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('consumes a handoff on the initial Home mount', async () => {
    MothershipHandoffStorage.store({ message: 'initial prompt' }, 'workspace-1')

    await act(async () => {
      root.render(<TestHarness renderKey={0} />)
    })

    expect(mockSendMessage).toHaveBeenCalledWith('initial prompt', undefined, undefined)
  })

  it('consumes a handoff when a cached Home route receives the URL signal', async () => {
    await act(async () => {
      root.render(<TestHarness renderKey={0} />)
    })
    MothershipHandoffStorage.store({ message: 'cached route prompt' }, 'workspace-1')
    mockQueryState.value = '1'

    await act(async () => {
      root.render(<TestHarness renderKey={1} />)
    })

    expect(mockSendMessage).toHaveBeenCalledWith('cached route prompt', undefined, undefined)
    expect(mockQueryState.setValue).toHaveBeenCalledWith(null)
  })
})
