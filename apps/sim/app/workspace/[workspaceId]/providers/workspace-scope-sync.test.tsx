/** @vitest-environment jsdom */
import { act, useLayoutEffect, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ registry: vi.fn(), switchWorkspace: vi.fn() }))
vi.mock('@/stores/workflows/registry/store', () => ({ useWorkflowRegistry: mocks.registry }))
vi.mock('next/navigation', () => ({ useParams: () => ({}) }))
vi.mock('posthog-js/react', () => ({ usePostHog: () => null }))
vi.mock('@/hooks/queries/workspace', () => ({ useWorkspacesWithMetadata: () => ({}) }))

import { WorkflowScopeSync } from '@/app/workspace/[workspaceId]/providers/workspace-scope-sync'

interface RegistryState {
  hydration: { workspaceId: string | null }
  switchToWorkspace: (workspaceId: string) => void
}
let state: RegistryState
let root: Root
let container: HTMLDivElement
const listeners = new Set<() => void>()
const mountedScopes: (string | null)[] = []
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
function Canvas({ workspaceId }: { workspaceId: string }) {
  useLayoutEffect(() => {
    mountedScopes.push(state.hydration.workspaceId)
  }, [workspaceId])
  return <p>Canvas {workspaceId}</p>
}
const render = async (workspaceId: string) => {
  await act(async () => {
    root.render(
      <WorkflowScopeSync workspaceId={workspaceId}>
        <Canvas workspaceId={workspaceId} />
      </WorkflowScopeSync>
    )
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mountedScopes.length = 0
  state = { hydration: { workspaceId: null }, switchToWorkspace: mocks.switchWorkspace }
  Object.assign(mocks.registry, { getState: () => state })
  mocks.registry.mockImplementation((selector: (value: RegistryState) => unknown) =>
    useSyncExternalStore(subscribe, () => selector(state))
  )
  mocks.switchWorkspace.mockImplementation((workspaceId: string) => {
    state = { ...state, hydration: { workspaceId } }
    for (const listener of listeners) listener()
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  listeners.clear()
  vi.unstubAllGlobals()
})

describe('WorkflowScopeSync canvas readiness', () => {
  it('establishes explicit scope before the first canvas layout effect', async () => {
    await render('workspace-a')
    expect(mountedScopes).toEqual(['workspace-a'])
    expect(mocks.switchWorkspace).toHaveBeenCalledExactlyOnceWith('workspace-a')
    expect(container.textContent).toBe('Canvas workspace-a')
  })

  it('does not mount a new owner canvas under the previous workspace scope', async () => {
    await render('workspace-a')
    await render('workspace-b')
    expect(mountedScopes).toEqual(['workspace-a', 'workspace-b'])
    expect(mocks.switchWorkspace.mock.calls).toEqual([['workspace-a'], ['workspace-b']])
    expect(container.textContent).toBe('Canvas workspace-b')
  })

  it('preserves an already aligned registry without resetting workflow state', async () => {
    state = { ...state, hydration: { workspaceId: 'workspace-a' } }
    await render('workspace-a')
    expect(mountedScopes).toEqual(['workspace-a'])
    expect(mocks.switchWorkspace).not.toHaveBeenCalled()
  })

  it('shares one scope transition between resource actions and canvas', async () => {
    await act(async () =>
      root.render(
        <>
          <WorkflowScopeSync workspaceId='workspace-a'>
            <Canvas workspaceId='workspace-a' />
          </WorkflowScopeSync>
          <WorkflowScopeSync workspaceId='workspace-a'>
            <Canvas workspaceId='workspace-a' />
          </WorkflowScopeSync>
        </>
      )
    )
    expect(mocks.switchWorkspace).toHaveBeenCalledExactlyOnceWith('workspace-a')
    expect(mountedScopes).toEqual(['workspace-a', 'workspace-a'])
  })
})
