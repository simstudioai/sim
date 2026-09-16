/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HeroPlatformLoop } from '@/app/(landing)/components/hero/components/hero-platform-loop/hero-platform-loop'
import { DEFAULT_USER_MESSAGE } from '@/app/(landing)/components/hero/components/hero-platform-loop/preview-chat-content'

interface ChatProps {
  phase: string
  composerValue: string
  userMessage: string
  showWelcome: boolean
  isSending: boolean
  onStopGeneration: () => void
  onComposerFocus: () => void
  onComposerValueChange: (value: string) => void
  onSubmit: () => void
}

let chat: ChatProps
let completeIntro: (reducedMotion: boolean) => void
let builtCount: number
let runWorkflow: () => void

vi.mock('@sim/emcn', () => ({
  cn: (...values: Array<string | false | undefined>) => values.filter(Boolean).join(' '),
  Button: ({ children }: { children: ReactNode }) => <button type='button'>{children}</button>,
  Tooltip: {
    Root: ({ children }: { children: ReactNode }) => children,
    Trigger: ({ children }: { children: ReactNode }) => children,
    Content: () => null,
  },
}))
vi.mock('@sim/emcn/icons', () => ({ PanelLeft: () => null }))
vi.mock('@/hooks/use-drag-resize', () => ({
  useDragResize: () => ({ handlePointerDown: vi.fn() }),
}))
vi.mock('@/app/(landing)/components/shared/hero-loop-shell', () => ({
  HeroLoopShell: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/app/(landing)/components/hero/components/hero-platform-intro', () => ({
  HeroPlatformIntro: ({
    children,
    onComplete,
  }: {
    children: ReactNode
    onComplete: typeof completeIntro
  }) => {
    completeIntro = onComplete
    return children
  },
}))
vi.mock('@/app/(landing)/components/hero/components/hero-chat-loop', () => ({
  HeroChatLoop: (props: ChatProps) => {
    chat = props
    return null
  },
}))
vi.mock(
  '@/app/(landing)/components/hero/components/hero-platform-loop/hero-resource-panel',
  () => ({
    HeroResourcePanel: (props: { builtCount: number; onRunWorkflow: () => void }) => {
      builtCount = props.builtCount
      runWorkflow = props.onRunWorkflow
      return null
    },
  })
)
vi.mock('@/app/(landing)/components/hero/components/hero-platform-loop/stage-data', () => ({
  STAGE_BLOCKS: Array.from({ length: 6 }, (_, id) => ({ id })),
}))

let root: Root
let host: HTMLDivElement
let reducedMotion: boolean
let motionListeners: Set<() => void>

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'],
  })
  reducedMotion = false
  motionListeners = new Set()
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return reducedMotion
    },
    addEventListener: (_event: string, callback: () => void) => motionListeners.add(callback),
    removeEventListener: (_event: string, callback: () => void) => motionListeners.delete(callback),
  }))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root.render(<HeroPlatformLoop />))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function advance(ms: number) {
  act(() => vi.advanceTimersByTime(ms))
}

function panel() {
  return host.querySelector('[data-resource-open]')
}

describe('HeroPlatformLoop opening', () => {
  it('thinks and dispatches before showing agent activity, opening the workflow, and building it', () => {
    expect(chat.phase).toBe('idle')
    expect(chat.showWelcome).toBe(true)
    expect(panel()?.getAttribute('data-resource-open')).toBe('false')
    expect(panel()?.hasAttribute('inert')).toBe(true)
    advance(10_000)
    expect(chat.composerValue).toBe('')

    act(() => completeIntro(false))
    advance(1_000)
    expect(chat.phase).toBe('compose')
    expect(chat.composerValue.length).toBeGreaterThan(0)
    expect(DEFAULT_USER_MESSAGE.startsWith(chat.composerValue)).toBe(true)
    expect(panel()?.getAttribute('data-resource-open')).toBe('false')

    advance(3_000)
    expect(chat.phase).toBe('user')
    expect(chat.composerValue).toBe('')
    expect(chat.userMessage).toBe(DEFAULT_USER_MESSAGE)
    advance(319)
    expect(chat.phase).toBe('user')
    advance(1)
    expect(chat.phase).toBe('thinking')
    expect(chat.isSending).toBe(true)
    advance(3_549)
    expect(chat.phase).toBe('thinking')
    expect(builtCount).toBe(0)
    expect(panel()?.getAttribute('data-resource-open')).toBe('false')
    advance(1)
    expect(chat.phase).toBe('dispatching')
    advance(650)
    expect(chat.phase).toBe('building')
    expect(chat.isSending).toBe(true)
    expect(panel()?.getAttribute('data-resource-open')).toBe('false')
    advance(600)
    expect(panel()?.getAttribute('data-resource-open')).toBe('true')
    expect(panel()?.hasAttribute('inert')).toBe(false)
    expect(builtCount).toBe(0)
    advance(550)
    expect(builtCount).toBe(1)
    advance(4_000)
    expect(builtCount).toBe(6)
    expect(chat.phase).toBe('reply')
    expect(chat.isSending).toBe(false)
  })

  it('lets a visitor take over typing and submit their own prompt', () => {
    act(() => completeIntro(false))
    advance(1_000)
    act(() => chat.onComposerFocus())
    const pausedPrompt = chat.composerValue
    advance(10_000)
    expect(chat.phase).toBe('idle')
    expect(chat.composerValue).toBe(pausedPrompt)

    act(() => chat.onComposerValueChange('Build a pipeline report'))
    advance(10_000)
    expect(chat.composerValue).toBe('Build a pipeline report')
    expect(panel()?.getAttribute('data-resource-open')).toBe('false')
    act(() => chat.onSubmit())
    expect(chat.phase).toBe('user')
    expect(chat.userMessage).toBe('Build a pipeline report')
    advance(1_200)
    expect(chat.phase).toBe('thinking')
    expect(panel()?.getAttribute('data-resource-open')).toBe('false')
    advance(3_920)
    expect(panel()?.getAttribute('data-resource-open')).toBe('true')
  })

  it('cancels automatic typing when a suggested prompt replaces the composer value', () => {
    act(() => completeIntro(false))
    advance(1_000)
    act(() => chat.onComposerValueChange('Post deal alerts to #sales'))
    advance(10_000)
    expect(chat.phase).toBe('idle')
    expect(chat.composerValue).toBe('Post deal alerts to #sales')
    expect(panel()?.getAttribute('data-resource-open')).toBe('false')
  })

  it('shows the finished preview without typing when the entrance reports reduced motion', () => {
    act(() => completeIntro(true))
    expect(chat.phase).toBe('reply')
    expect(chat.composerValue).toBe('')
    expect(builtCount).toBe(6)
    expect(panel()?.getAttribute('data-resource-open')).toBe('true')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('settles the preview when reduced motion is enabled during typing', () => {
    act(() => completeIntro(false))
    advance(1_000)
    act(() => {
      reducedMotion = true
      motionListeners.forEach((listener) => listener())
    })
    expect(chat.phase).toBe('reply')
    expect(chat.composerValue).toBe('')
    expect(builtCount).toBe(6)
    expect(panel()?.getAttribute('data-resource-open')).toBe('true')
    expect(vi.getTimerCount()).toBe(0)
    expect(motionListeners.size).toBe(0)
  })

  it('cancels the pending thinking and build sequence when generation is stopped', () => {
    act(() => chat.onComposerValueChange('Build a pipeline report'))
    act(() => chat.onSubmit())
    advance(1_000)
    expect(chat.phase).toBe('thinking')
    act(() => chat.onStopGeneration())
    expect(chat.isSending).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    advance(10_000)
    expect(chat.phase).toBe('reply')
    expect(builtCount).toBe(6)
  })

  it('restarts thinking for a new submission without an old timer opening the workflow', () => {
    act(() => chat.onComposerValueChange('Build a report'))
    act(() => chat.onSubmit())
    advance(1_000)
    act(() => chat.onComposerValueChange('Enrich new leads'))
    act(() => chat.onSubmit())
    advance(3_000)
    expect(chat.userMessage).toBe('Enrich new leads')
    expect(chat.phase).toBe('thinking')
    expect(builtCount).toBe(0)
    expect(panel()?.getAttribute('data-resource-open')).toBe('false')
    advance(1_520)
    expect(chat.phase).toBe('building')
  })

  it('settles and clears delayed work when reduced motion is enabled during thinking', () => {
    act(() => chat.onComposerValueChange('Build a report'))
    act(() => chat.onSubmit())
    advance(1_000)
    act(() => {
      reducedMotion = true
      motionListeners.forEach((listener) => listener())
    })
    expect(chat.phase).toBe('reply')
    expect(chat.isSending).toBe(false)
    expect(builtCount).toBe(6)
    expect(panel()?.getAttribute('data-resource-open')).toBe('true')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cleans up automatic typing and motion listeners on unmount', () => {
    act(() => completeIntro(false))
    advance(1_000)
    act(() => root.unmount())
    expect(vi.getTimerCount()).toBe(0)
    expect(motionListeners.size).toBe(0)
  })

  it('cancels a pending rerun before thinking through a new submission', () => {
    act(() => completeIntro(true))
    act(() => runWorkflow())
    advance(400)
    expect(builtCount).toBe(2)
    act(() => chat.onComposerValueChange('Build a new report'))
    act(() => chat.onSubmit())
    advance(2_000)
    expect(chat.phase).toBe('thinking')
    expect(builtCount).toBe(0)
    expect(panel()?.getAttribute('data-resource-open')).toBe('false')
  })

  it('cancels pending chat build timers when the visitor runs the workflow', () => {
    act(() => chat.onComposerValueChange('Build a report'))
    act(() => chat.onSubmit())
    advance(1_000)
    act(() => runWorkflow())
    advance(5_000)
    expect(chat.phase).toBe('reply')
    expect(chat.isSending).toBe(false)
    expect(builtCount).toBe(6)
  })

  it('cancels a pending rerun when generation is stopped', () => {
    act(() => completeIntro(true))
    act(() => runWorkflow())
    advance(400)
    act(() => chat.onStopGeneration())
    expect(vi.getTimerCount()).toBe(0)
    advance(1_000)
    expect(builtCount).toBe(6)
  })

  it('settles reruns immediately when motion is reduced', () => {
    reducedMotion = true
    act(() => completeIntro(true))
    act(() => runWorkflow())
    expect(builtCount).toBe(6)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('settles an active rerun when reduced motion is enabled', () => {
    act(() => completeIntro(true))
    act(() => runWorkflow())
    advance(400)
    expect(builtCount).toBe(2)
    act(() => {
      reducedMotion = true
      motionListeners.forEach((listener) => listener())
    })
    expect(builtCount).toBe(6)
    expect(vi.getTimerCount()).toBe(0)
  })
})
