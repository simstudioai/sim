/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { NuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MothershipMode } from '@/app/workspace/[workspaceId]/home/search-params'

const { mockMemberAccessAvailable, history } = vi.hoisted(() => ({
  mockMemberAccessAvailable: vi.fn(() => true),
  history: {
    messages: [] as { role: 'user' | 'assistant'; requestMode?: 'agent' | 'assistant' }[],
  },
}))
const mockUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>()

vi.mock('@/hooks/use-member-access', () => ({
  useMemberAccessAvailable: () => mockMemberAccessAvailable(),
}))
vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1', chatId: 'chat-1' }),
  usePathname: () => '/workspace/workspace-1/home',
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/hooks/queries/mothership-chats', () => ({
  useMothershipChatHistory: () => ({ data: history }),
}))

import { useMothershipMode } from '@/app/workspace/[workspaceId]/home/hooks/use-mothership-mode'

let root: Root | null = null
let container: HTMLDivElement | null = null
let current: ReturnType<typeof useMothershipMode> | null = null

function Probe() {
  current = useMothershipMode()
  return null
}

function mount(searchParams = '') {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  navigate(searchParams)
}

function navigate(searchParams: string) {
  act(() =>
    root?.render(
      <NuqsTestingAdapter hasMemory searchParams={searchParams} onUrlUpdate={mockUrlUpdate}>
        <Probe />
      </NuqsTestingAdapter>
    )
  )
}

function mode(): MothershipMode {
  if (!current) throw new Error('Probe did not render')
  return current[0]
}

/** nuqs batches its URL write onto a timeout, so a write is read back after the tick. */
async function setMode(next: MothershipMode) {
  await act(async () => {
    current?.[1](next)
    await vi.advanceTimersByTimeAsync(1)
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  mockMemberAccessAvailable.mockReturnValue(true)
  history.messages = []
  mockUrlUpdate.mockClear()
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  current = null
  vi.useRealTimers()
})

/**
 * The mode's ordinary read/write behavior is covered through the UI in
 * `mode-switcher.test.tsx`; one write stands here as the control the
 * per-member-access cases are read against.
 */
describe('useMothershipMode', () => {
  it('writes the chosen mode to the URL', async () => {
    mount()
    await setMode('search')

    expect(mode()).toBe('search')
    expect(mockUrlUpdate.mock.lastCall?.[0].searchParams.get('mode')).toBe('search')
  })

  it.each([
    ['agent', 'assistant', 'assistant'],
    ['assistant', 'agent', 'build'],
  ] as const)('resumes the latest user mode, %s then %s', (first, last, expected) => {
    history.messages = [
      { role: 'user', requestMode: first },
      { role: 'user', requestMode: last },
      { role: 'assistant', requestMode: first },
    ]
    mount()
    expect(mode()).toBe(expected)
    expect(mockUrlUpdate).not.toHaveBeenCalled()
  })

  it.each(['build', 'search', 'assistant'] as const)(
    'respects explicit URL mode %s on reload',
    (explicit) => {
      history.messages = [{ role: 'user', requestMode: 'assistant' }]
      mount(`?mode=${explicit}`)
      expect(mode()).toBe(explicit)
    }
  )

  it('opens a query-only link in Search without writing a mode or message', () => {
    mount('?q=budget')
    expect(mode()).toBe('search')
    expect(mockUrlUpdate).not.toHaveBeenCalled()
  })

  it('keeps explicit Build even when the URL also contains a query', () => {
    mount('?mode=build&q=budget')
    expect(mode()).toBe('build')
  })

  it('follows back and forward URL changes without overriding them from history', () => {
    history.messages = [{ role: 'user', requestMode: 'assistant' }]
    mount('?mode=build')
    expect(mode()).toBe('build')
    navigate('?mode=search&q=budget')
    expect(mode()).toBe('search')
    navigate('?mode=build')
    expect(mode()).toBe('build')
    navigate('')
    expect(mode()).toBe('assistant')
    expect(mockUrlUpdate).not.toHaveBeenCalled()
  })

  it('keeps the selected mode when an earlier in-flight turn finishes persisting', async () => {
    history.messages = [{ role: 'user', requestMode: 'agent' }]
    mount()
    await setMode('search')
    history.messages = [...history.messages, { role: 'user', requestMode: 'assistant' }]
    navigate('?mode=search')
    expect(mode()).toBe('search')
  })

  describe('without per-member access', () => {
    beforeEach(() => {
      mockMemberAccessAvailable.mockReturnValue(false)
    })

    it('reads Build from a link naming a mode the workspace does not have', () => {
      mount('?mode=search')

      expect(mode()).toBe('build')
    })

    it('writes no mode the workspace does not have', async () => {
      mount()
      await setMode('search')

      expect(mode()).toBe('build')
      expect(mockUrlUpdate).not.toHaveBeenCalled()
    })

    it('still returns to Build, so a stale link can be left', async () => {
      mount('?mode=search&q=budget')
      await setMode('build')

      expect(mode()).toBe('build')
      expect(mockUrlUpdate.mock.lastCall?.[0].searchParams.toString()).toBe('mode=build')
    })
  })
})
