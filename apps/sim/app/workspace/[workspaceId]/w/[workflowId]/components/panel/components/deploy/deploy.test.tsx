/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  hydrationPhase: 'ready' as 'idle' | 'state-loading' | 'ready',
  hydrationWorkflowId: 'workflow-1' as string | null,
  registryActiveWorkflowId: 'workflow-1' as string | null,
  hasBlocks: true,
  isDeployed: false,
  changeDetected: false,
  isChangeDetectionSettling: false,
  isDeploying: false,
  readiness: {
    isBlocked: false,
    isSyncing: false,
    tooltip: 'Ready to deploy',
  },
  handleDeployClick: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type='button' {...props}>
      {children}
    </button>
  ),
  cn: (...classes: Array<string | undefined>) => classes.filter(Boolean).join(' '),
  Tooltip: {
    Root: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Trigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  },
}))

vi.mock('@sim/emcn/icons', () => ({
  Upload: () => <span />,
}))

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/deploy-modal',
  () => ({
    DeployModal: ({ open }: { open: boolean }) =>
      open ? <div role='dialog'>Deploy workflow</div> : null,
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks',
  () => ({
    useChangeDetection: () => ({
      changeDetected: mockState.changeDetected,
      isChangeDetectionSettling: mockState.isChangeDetectionSettling,
    }),
    useDeployment: () => ({
      isDeploying: mockState.isDeploying,
      handleDeployClick: mockState.handleDeployClick,
    }),
    useDeployReadiness: () => ({
      ...mockState.readiness,
      status: mockState.readiness.isBlocked ? 'saving' : 'ready',
      isReady: !mockState.readiness.isBlocked,
      waitUntilReady: vi.fn(),
    }),
  })
)

vi.mock('@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-current-workflow', () => ({
  useCurrentWorkflow: () => ({ hasBlocks: () => mockState.hasBlocks }),
}))

vi.mock('@/hooks/queries/deployments', () => ({
  useDeploymentInfo: () => ({ data: { isDeployed: mockState.isDeployed } }),
  useDeployedWorkflowState: () => ({ data: null, isLoading: false, isFetching: false }),
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: (selector: (state: unknown) => unknown) =>
    selector({
      activeWorkflowId: mockState.registryActiveWorkflowId,
      hydration: {
        phase: mockState.hydrationPhase,
        workflowId: mockState.hydrationWorkflowId,
      },
    }),
}))

import { Deploy } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/deploy'

let container: HTMLDivElement
let root: Root

function renderDeploy(
  overrides: Partial<typeof mockState> = {},
  props: { disabled?: boolean; canAdmin?: boolean } = {}
) {
  Object.assign(mockState, overrides)
  act(() => {
    root.render(
      <Deploy
        activeWorkflowId='workflow-1'
        userPermissions={{
          canRead: true,
          canEdit: true,
          canAdmin: props.canAdmin ?? true,
          userPermissions: props.canAdmin === false ? 'write' : 'admin',
          isLoading: false,
          error: null,
        }}
        compact
        disabled={props.disabled}
      />
    )
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mockState.hydrationPhase = 'ready'
  mockState.hydrationWorkflowId = 'workflow-1'
  mockState.registryActiveWorkflowId = 'workflow-1'
  mockState.hasBlocks = true
  mockState.isDeployed = false
  mockState.changeDetected = false
  mockState.isChangeDetectionSettling = false
  mockState.isDeploying = false
  mockState.readiness = {
    isBlocked: false,
    isSyncing: false,
    tooltip: 'Ready to deploy',
  }
  mockState.handleDeployClick.mockReset()
  mockState.handleDeployClick.mockResolvedValue({ success: true, shouldOpenModal: true })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('Deploy compact mode', () => {
  it.each([
    ['Deploy', {}],
    ['Live', { isDeployed: true }],
    ['Update', { isDeployed: true, changeDetected: true }],
  ])('exposes the %s action for its deployment state', (label, overrides) => {
    renderDeploy(overrides)

    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(label)
  })

  it.each([
    ['non-admin users', {}, { canAdmin: false }],
    ['empty workflows', { hasBlocks: false }, {}],
    ['locked workflows', {}, { disabled: true }],
    [
      'unsynchronized workflows',
      {
        readiness: { isBlocked: true, isSyncing: false, tooltip: 'Saving workflow changes' },
      },
      {},
    ],
    [
      'workflows that are still loading',
      { hydrationWorkflowId: 'workflow-2', registryActiveWorkflowId: 'workflow-2' },
      {},
    ],
  ])('disables the action for %s', (_reason, overrides, props) => {
    renderDeploy(overrides, props)

    expect(container.querySelector('button')?.disabled).toBe(true)
  })

  it('opens the existing deployment modal after a successful deployment action', async () => {
    renderDeploy()

    await act(async () => {
      container.querySelector('button')?.click()
    })

    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
  })
})
