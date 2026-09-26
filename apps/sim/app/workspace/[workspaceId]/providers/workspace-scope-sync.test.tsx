/** @vitest-environment jsdom */

import { act, useLayoutEffect, useSyncExternalStore } from 'react'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import {
  workflowRegistryStoreMock,
  workflowRegistryStoreMockFns,
} from '@sim/testing/mocks/workflow-registry-store.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/stores/workflows/registry/store', () => workflowRegistryStoreMock)
vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('posthog-js/react', () => ({ usePostHog: () => null }))
vi.mock('@/hooks/queries/workspace', () => ({ useWorkspacesWithMetadata: () => ({}) }))

import { WorkflowScopeSync } from '@/app/workspace/[workspaceId]/providers/workspace-scope-sync'

const mocks = {
  registry: workflowRegistryStoreMockFns.mockUseWorkflowRegistry,
  switchWorkspace: workflowRegistryStoreMockFns.mockSwitchToWorkspace,
}

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
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mountedScopes.length = 0
  state = { hydration: { workspaceId: null }, switchToWorkspace: mocks.switchWorkspace }
  workflowRegistryStoreMockFns.mockGetState.mockImplementation(() => ({ ...state }))
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
})

describe('WorkflowScopeSync canvas readiness', () => {
  it('does not mount a new owner canvas under the previous workspace scope', async () => {
    await render('workspace-a')
    await render('workspace-b')
    expect(mountedScopes).toEqual(['workspace-a', 'workspace-b'])
    expect(mocks.switchWorkspace.mock.calls).toEqual([['workspace-a'], ['workspace-b']])
    expect(container.textContent).toBe('Canvas workspace-b')
  })
})
