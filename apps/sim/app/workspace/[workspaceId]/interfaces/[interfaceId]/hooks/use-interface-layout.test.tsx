/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockMutate, mockUseUpdateInterface } = vi.hoisted(() => ({
  /**
   * Stable across renders on purpose: `write` — and therefore the unmount-flush
   * effect that depends on it — is keyed by this identity, so a fresh `vi.fn()`
   * per render would tear down and re-run the flush every render.
   */
  mockMutate: vi.fn(),
  mockUseUpdateInterface: vi.fn(),
}))

vi.mock('@/hooks/queries/interfaces', () => ({
  useUpdateInterface: mockUseUpdateInterface,
}))

import type { FormModuleConfig, InterfaceLayout, InterfaceModule } from '@/lib/interfaces'
import {
  type UseInterfaceLayoutArgs,
  type UseInterfaceLayoutResult,
  useInterfaceLayout,
} from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/hooks/use-interface-layout'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const WORKSPACE_ID = 'ws-1'
const INTERFACE_ID = 'if-1'
const UPDATED_AT = '2026-01-01T00:00:00.000Z'
const DEBOUNCE_MS = 400

const onModuleAdded = vi.fn()

let container: HTMLDivElement
let root: Root
let latest: UseInterfaceLayoutResult

function formModule(id: string, row: 0 | 1, col: 0 | 1, submitLabel = 'Submit'): InterfaceModule {
  return {
    id,
    type: 'form',
    placement: { row, col, rowSpan: 1, colSpan: 1 },
    config: { workflowId: null, fields: [], submitLabel },
  }
}

function layoutOf(...modules: InterfaceModule[]): InterfaceLayout {
  return { version: 1, grid: { rows: 2, cols: 2 }, modules }
}

function configOf(submitLabel: string): FormModuleConfig {
  return { workflowId: null, fields: [], submitLabel }
}

function Probe({ args }: { args: UseInterfaceLayoutArgs }) {
  latest = useInterfaceLayout(args)
  return null
}

function render(args: Partial<UseInterfaceLayoutArgs> = {}) {
  act(() => {
    root.render(
      <Probe
        args={{
          workspaceId: WORKSPACE_ID,
          interfaceId: INTERFACE_ID,
          layout: layoutOf(),
          updatedAt: UPDATED_AT,
          onModuleAdded,
          ...args,
        }}
      />
    )
  })
}

interface WriteVariables {
  interfaceId: string
  layout: InterfaceLayout
  expectedUpdatedAt?: string
}

function writes(): WriteVariables[] {
  return mockMutate.mock.calls.map((call) => call[0] as WriteVariables)
}

/** `${moduleId}@${row},${col}` for every module the write carried. */
function placementsOf(index: number): string[] {
  return writes()[index].layout.modules.map(
    (module) => `${module.id}@${module.placement.row},${module.placement.col}`
  )
}

function submitLabelsOf(index: number): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const module of writes()[index].layout.modules) {
    if (module.type === 'form') labels[module.id] = module.config.submitLabel
  }
  return labels
}

/** Resolves one in-flight write the way TanStack's `onSettled` would. */
function settle(index: number) {
  act(() => {
    ;(mockMutate.mock.calls[index][1] as { onSettled?: () => void } | undefined)?.onSettled?.()
  })
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  /**
   * Only the debounce timer is faked — React's own scheduling stays on the real
   * clock so `act` keeps flushing normally.
   */
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  mockUseUpdateInterface.mockReturnValue({ mutate: mockMutate, isPending: false })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('useInterfaceLayout — structural edits', () => {
  it('creates the mutation for the interface owning workspace', () => {
    render()
    expect(mockUseUpdateInterface).toHaveBeenCalledWith(WORKSPACE_ID)
  })

  it('sends the whole layout as one replace when a module is added', () => {
    render()

    act(() => latest.addModule('chat', { row: 1, col: 0 }))

    expect(writes()).toHaveLength(1)
    expect(writes()[0].interfaceId).toBe(INTERFACE_ID)
    expect(writes()[0].layout.version).toBe(1)
    expect(writes()[0].layout.modules).toHaveLength(1)
    expect(writes()[0].layout.modules[0]).toMatchObject({
      type: 'chat',
      placement: { row: 1, col: 0, rowSpan: 1, colSpan: 1 },
    })
  })

  it('hands the new module id back so the caller can select it', () => {
    render()

    act(() => latest.addModule('form', { row: 0, col: 0 }))

    expect(onModuleAdded).toHaveBeenCalledWith(writes()[0].layout.modules[0].id)
  })

  it('keeps the modules already on the layout when adding', () => {
    render({ layout: layoutOf(formModule('a', 0, 0)) })

    act(() => latest.addModule('table', { row: 0, col: 1 }))

    expect(placementsOf(0)[0]).toBe('a@0,0')
    expect(writes()[0].layout.modules).toHaveLength(2)
  })

  it('refuses to add into an occupied cell', () => {
    render({ layout: layoutOf(formModule('a', 0, 0)) })

    act(() => latest.addModule('chat', { row: 0, col: 0 }))

    expect(mockMutate).not.toHaveBeenCalled()
    expect(onModuleAdded).not.toHaveBeenCalled()
  })

  it('swaps a moved module with the cell occupant', () => {
    render({ layout: layoutOf(formModule('a', 0, 0), formModule('b', 1, 1)) })

    act(() => latest.moveModule('a', { row: 1, col: 1 }))

    expect(placementsOf(0)).toEqual(['a@1,1', 'b@0,0'])
  })

  it('sends nothing for a move that changes nothing', () => {
    render({ layout: layoutOf(formModule('a', 0, 0)) })

    act(() => latest.moveModule('a', { row: 0, col: 0 }))
    act(() => latest.moveModule('missing', { row: 1, col: 1 }))

    expect(mockMutate).not.toHaveBeenCalled()
  })

  it('removes a module from the layout it sends', () => {
    render({ layout: layoutOf(formModule('a', 0, 0), formModule('b', 1, 1)) })

    act(() => latest.removeModule('a'))

    expect(placementsOf(0)).toEqual(['b@1,1'])
  })

  it('sends nothing when removing a module that is not there', () => {
    render({ layout: layoutOf(formModule('a', 0, 0)) })

    act(() => latest.removeModule('missing'))

    expect(mockMutate).not.toHaveBeenCalled()
  })
})

describe('useInterfaceLayout — optimistic concurrency', () => {
  it('guards the first write with the record updatedAt', () => {
    render({ layout: layoutOf(formModule('a', 0, 0)) })

    act(() => latest.removeModule('a'))

    expect(writes()[0].expectedUpdatedAt).toBe(UPDATED_AT)
  })

  it('leaves the write unguarded while the record has not loaded', () => {
    render({ layout: layoutOf(formModule('a', 0, 0)), updatedAt: undefined })

    act(() => latest.removeModule('a'))

    expect(writes()[0].expectedUpdatedAt).toBeUndefined()
  })

  it('withholds the precondition while one of its own writes is in flight', () => {
    render({ layout: layoutOf(formModule('a', 0, 0)) })

    act(() => latest.moveModule('a', { row: 1, col: 1 }))
    act(() => latest.moveModule('a', { row: 0, col: 1 }))

    expect(writes().map((write) => write.expectedUpdatedAt)).toEqual([UPDATED_AT, undefined])
  })

  it('restores the precondition once every own write has settled', () => {
    render({ layout: layoutOf(formModule('a', 0, 0)) })

    act(() => latest.moveModule('a', { row: 1, col: 1 }))
    settle(0)
    act(() => latest.moveModule('a', { row: 0, col: 1 }))

    expect(writes()[1].expectedUpdatedAt).toBe(UPDATED_AT)
  })

  it('keeps withholding it until the last of several own writes settles', () => {
    render({ layout: layoutOf(formModule('a', 0, 0)) })

    act(() => latest.moveModule('a', { row: 1, col: 1 }))
    act(() => latest.moveModule('a', { row: 0, col: 1 }))
    settle(0)
    act(() => latest.moveModule('a', { row: 1, col: 0 }))

    expect(writes()[2].expectedUpdatedAt).toBeUndefined()

    settle(1)
    settle(2)
    act(() => latest.moveModule('a', { row: 1, col: 1 }))

    expect(writes()[3].expectedUpdatedAt).toBe(UPDATED_AT)
  })
})

describe('useInterfaceLayout — debounced config edits', () => {
  it('holds an edit for the debounce window before sending it', () => {
    render({ layout: layoutOf(formModule('a', 0, 0)) })

    act(() => latest.updateModuleConfig('a', configOf('Go'), true))
    advance(DEBOUNCE_MS - 1)
    expect(mockMutate).not.toHaveBeenCalled()

    advance(1)
    expect(writes()).toHaveLength(1)
    expect(submitLabelsOf(0)).toEqual({ a: 'Go' })
  })

  it('collapses rapid keystrokes into one trailing write', () => {
    render({ layout: layoutOf(formModule('a', 0, 0)) })

    act(() => latest.updateModuleConfig('a', configOf('G'), true))
    advance(100)
    act(() => latest.updateModuleConfig('a', configOf('Go'), true))
    advance(100)
    act(() => latest.updateModuleConfig('a', configOf('Go!'), true))
    advance(DEBOUNCE_MS)

    expect(writes()).toHaveLength(1)
    expect(submitLabelsOf(0)).toEqual({ a: 'Go!' })
  })

  it('leaves every other module untouched', () => {
    render({ layout: layoutOf(formModule('a', 0, 0, 'A'), formModule('b', 1, 1, 'B')) })

    act(() => latest.updateModuleConfig('a', configOf('Changed'), true))
    advance(DEBOUNCE_MS)

    expect(submitLabelsOf(0)).toEqual({ a: 'Changed', b: 'B' })
  })

  it('ignores an edit for a module that is not on the layout', () => {
    render({ layout: layoutOf(formModule('a', 0, 0)) })

    act(() => latest.updateModuleConfig('missing', configOf('Go'), true))
    advance(DEBOUNCE_MS)

    expect(mockMutate).not.toHaveBeenCalled()
  })

  it('never sends an invalid config', () => {
    render({ layout: layoutOf(formModule('a', 0, 0)) })

    act(() => latest.updateModuleConfig('a', configOf(''), false))
    advance(DEBOUNCE_MS * 5)

    expect(mockMutate).not.toHaveBeenCalled()
  })

  it('sends the edit once the config becomes valid again', () => {
    render({ layout: layoutOf(formModule('a', 0, 0)) })

    act(() => latest.updateModuleConfig('a', configOf(''), false))
    advance(DEBOUNCE_MS)
    act(() => latest.updateModuleConfig('a', configOf('Fixed'), true))
    advance(DEBOUNCE_MS)

    expect(writes()).toHaveLength(1)
    expect(submitLabelsOf(0)).toEqual({ a: 'Fixed' })
  })

  it('cancels a queued write when a later keystroke turns the config invalid', () => {
    render({ layout: layoutOf(formModule('a', 0, 0)) })

    act(() => latest.updateModuleConfig('a', configOf('Go'), true))
    advance(100)
    act(() => latest.updateModuleConfig('a', configOf(''), false))
    advance(DEBOUNCE_MS * 2)

    expect(mockMutate).not.toHaveBeenCalled()
  })
})

describe('useInterfaceLayout — structural edits and a pending config write', () => {
  it('folds a pending valid edit into the structural write instead of racing it', () => {
    render({ layout: layoutOf(formModule('a', 0, 0, 'A'), formModule('b', 1, 1, 'B')) })

    act(() => latest.updateModuleConfig('a', configOf('Edited'), true))
    act(() => latest.removeModule('b'))

    expect(writes()).toHaveLength(1)
    expect(placementsOf(0)).toEqual(['a@0,0'])
    expect(submitLabelsOf(0)).toEqual({ a: 'Edited' })

    advance(DEBOUNCE_MS * 2)
    expect(writes()).toHaveLength(1)
  })

  it('drops a pending invalid edit rather than carrying it into a structural write', () => {
    render({ layout: layoutOf(formModule('a', 0, 0, 'A'), formModule('b', 1, 1, 'B')) })

    act(() => latest.updateModuleConfig('a', configOf(''), false))
    act(() => latest.removeModule('b'))

    expect(writes()).toHaveLength(1)
    expect(submitLabelsOf(0)).toEqual({ a: 'A' })

    advance(DEBOUNCE_MS * 2)
    expect(writes()).toHaveLength(1)
  })

  it('folds a pending valid edit into an add', () => {
    render({ layout: layoutOf(formModule('a', 0, 0, 'A')) })

    act(() => latest.updateModuleConfig('a', configOf('Edited'), true))
    act(() => latest.addModule('chat', { row: 0, col: 1 }))

    expect(writes()).toHaveLength(1)
    expect(writes()[0].layout.modules).toHaveLength(2)
    expect(submitLabelsOf(0)).toEqual({ a: 'Edited' })
  })

  it('folds a pending valid edit into a move', () => {
    render({ layout: layoutOf(formModule('a', 0, 0, 'A')) })

    act(() => latest.updateModuleConfig('a', configOf('Edited'), true))
    act(() => latest.moveModule('a', { row: 1, col: 1 }))

    expect(writes()).toHaveLength(1)
    expect(placementsOf(0)).toEqual(['a@1,1'])
    expect(submitLabelsOf(0)).toEqual({ a: 'Edited' })
  })
})

describe('useInterfaceLayout — selection moving mid-debounce', () => {
  it('sends the queued edit immediately and keeps it as the base for the next one', () => {
    render({ layout: layoutOf(formModule('a', 0, 0, 'A'), formModule('b', 1, 1, 'B')) })

    act(() => latest.updateModuleConfig('a', configOf('Edited A'), true))
    act(() => latest.updateModuleConfig('b', configOf('Edited B'), true))

    expect(writes()).toHaveLength(1)
    expect(submitLabelsOf(0)).toEqual({ a: 'Edited A', b: 'B' })

    advance(DEBOUNCE_MS)

    expect(writes()).toHaveLength(2)
    expect(submitLabelsOf(1)).toEqual({ a: 'Edited A', b: 'Edited B' })
  })

  it('drops a queued invalid edit when the selection moves on', () => {
    render({ layout: layoutOf(formModule('a', 0, 0, 'A'), formModule('b', 1, 1, 'B')) })

    act(() => latest.updateModuleConfig('a', configOf(''), false))
    act(() => latest.updateModuleConfig('b', configOf('Edited B'), true))

    expect(mockMutate).not.toHaveBeenCalled()

    advance(DEBOUNCE_MS)

    expect(writes()).toHaveLength(1)
    expect(submitLabelsOf(0)).toEqual({ a: 'A', b: 'Edited B' })
  })
})

describe('useInterfaceLayout — unmount', () => {
  it('persists the last valid keystroke because the mutation outlives the editor', () => {
    render({ layout: layoutOf(formModule('a', 0, 0)) })

    act(() => latest.updateModuleConfig('a', configOf('Typed'), true))
    expect(mockMutate).not.toHaveBeenCalled()

    act(() => root.unmount())

    expect(writes()).toHaveLength(1)
    expect(submitLabelsOf(0)).toEqual({ a: 'Typed' })

    advance(DEBOUNCE_MS * 2)
    expect(writes()).toHaveLength(1)
  })

  it('discards a held invalid edit on unmount', () => {
    render({ layout: layoutOf(formModule('a', 0, 0)) })

    act(() => latest.updateModuleConfig('a', configOf(''), false))
    act(() => root.unmount())

    expect(mockMutate).not.toHaveBeenCalled()
  })

  it('writes nothing on unmount when the edit already flushed', () => {
    render({ layout: layoutOf(formModule('a', 0, 0)) })

    act(() => latest.updateModuleConfig('a', configOf('Typed'), true))
    advance(DEBOUNCE_MS)
    expect(writes()).toHaveLength(1)

    act(() => root.unmount())
    expect(writes()).toHaveLength(1)
  })
})

describe('useInterfaceLayout — isSaving', () => {
  it('reports the mutation pending state', () => {
    render()
    expect(latest.isSaving).toBe(false)

    mockUseUpdateInterface.mockReturnValue({ mutate: mockMutate, isPending: true })
    render()
    expect(latest.isSaving).toBe(true)
  })
})
