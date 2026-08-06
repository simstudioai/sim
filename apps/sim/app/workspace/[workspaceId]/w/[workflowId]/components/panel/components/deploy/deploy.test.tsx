/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  hydrationPhase: 'ready' as 'idle' | 'state-loading' | 'ready',
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
  modalProps: null as { open: boolean } | null,
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
  Upload: () => <span data-testid='upload-icon' />,
}))

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/deploy-modal',
  () => ({
    DeployModal: (props: { open: boolean }) => {
      mockState.modalProps = props
      return props.open ? <div role='dialog'>Deploy workflow</div> : null
    },
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
    selector({ hydration: { phase: mockState.hydrationPhase } }),
}))

import { Deploy } from './deploy'

let container: HTMLDivElement
let root: Root

function renderDeploy(overrides: Partial<typeof mockState> = {}) {
  Object.assign(mockState, overrides)
  act(() => {
    root.render(
      <Deploy
        activeWorkflowId='workflow-1'
        userPermissions={{
          canRead: true,
          canEdit: true,
          canAdmin: true,
          userPermissions: 'admin',
          isLoading: false,
          error: null,
        }}
        compact
        className='resource-action'
      />
    )
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mockState.hydrationPhase = 'ready'
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
  mockState.modalProps = null
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('Deploy compact mode', () => {
  it('renders an accessible compact Deploy action for an undeployed workflow', () => {
    renderDeploy()

    const button = container.querySelector('button')
    expect(button?.getAttribute('aria-label')).toBe('Deploy')
    expect(button?.className).toContain('resource-action')
    expect(container.querySelector('[data-testid="upload-icon"]')).not.toBeNull()
    expect(button?.getAttribute('variant')).toBe('subtle')
    expect(container.textContent).not.toContain('DeployLiveUpdate')
  })

  it('uses the deployment status in the compact action label', () => {
    renderDeploy({ isDeployed: true })
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('Live')

    renderDeploy({ isDeployed: true, changeDetected: true })
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('Update')
  })

  it.each([
    ['non-admin users', { canAdmin: false }],
    ['empty workflows', { hasBlocks: false }],
    ['locked workflows', { disabled: true }],
    [
      'unsynchronized workflows',
      {
        readiness: { isBlocked: true, isSyncing: false, tooltip: 'Saving workflow changes' },
      },
    ],
  ])('disables the action for %s', (_reason, overrides) => {
    const permissions =
      overrides.canAdmin === false
        ? {
            canRead: true,
            canEdit: true,
            canAdmin: false,
            userPermissions: 'write' as const,
            isLoading: false,
            error: null,
          }
        : undefined

    Object.assign(mockState, overrides)
    act(() => {
      root.render(
        <Deploy
          activeWorkflowId='workflow-1'
          userPermissions={
            permissions ?? {
              canRead: true,
              canEdit: true,
              canAdmin: true,
              userPermissions: 'admin',
              isLoading: false,
              error: null,
            }
          }
          compact
          disabled={overrides.disabled === true}
        />
      )
    })

    expect(container.querySelector('button')?.disabled).toBe(true)
  })

  it('opens the existing deployment modal after a successful deployment action', async () => {
    renderDeploy()

    await act(async () => {
      container.querySelector('button')?.click()
    })

    expect(mockState.handleDeployClick).toHaveBeenCalledOnce()
    expect(mockState.modalProps?.open).toBe(true)
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
  })
})
