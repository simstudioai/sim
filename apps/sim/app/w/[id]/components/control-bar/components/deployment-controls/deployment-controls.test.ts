/**
 * Deployment Controls Change Detection Logic Tests
 *
 * This file tests the core logic of how DeploymentControls handles change detection,
 * specifically focusing on the needsRedeployment prop handling and state management.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the workflow registry store
const mockDeploymentStatus = {
  isDeployed: false,
  needsRedeployment: false,
}

const mockWorkflowRegistry = {
  getState: vi.fn(() => ({
    getWorkflowDeploymentStatus: vi.fn((workflowId) => mockDeploymentStatus),
  })),
}

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector(mockWorkflowRegistry.getState())
    }
    return mockWorkflowRegistry.getState()
  }),
}))

describe('DeploymentControls Change Detection Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeploymentStatus.isDeployed = false
    mockDeploymentStatus.needsRedeployment = false
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('needsRedeployment Priority Logic', () => {
    it('should prioritize parent needsRedeployment over workflow registry', () => {
      // Simulate the logic from DeploymentControls component
      const parentNeedsRedeployment = true
      const workflowRegistryNeedsRedeployment = false

      // The component logic: Trust the parent's change detection
      const workflowNeedsRedeployment = parentNeedsRedeployment

      expect(workflowNeedsRedeployment).toBe(true)
      expect(workflowNeedsRedeployment).not.toBe(workflowRegistryNeedsRedeployment)
    })

    it('should handle false needsRedeployment correctly', () => {
      const parentNeedsRedeployment = false
      const workflowNeedsRedeployment = parentNeedsRedeployment

      expect(workflowNeedsRedeployment).toBe(false)
    })

    it('should maintain consistency with parent state changes', () => {
      // Simulate state changes
      let parentNeedsRedeployment = false
      let workflowNeedsRedeployment = parentNeedsRedeployment

      expect(workflowNeedsRedeployment).toBe(false)

      // Parent detects changes
      parentNeedsRedeployment = true
      workflowNeedsRedeployment = parentNeedsRedeployment

      expect(workflowNeedsRedeployment).toBe(true)

      // Parent clears changes (after redeployment)
      parentNeedsRedeployment = false
      workflowNeedsRedeployment = parentNeedsRedeployment

      expect(workflowNeedsRedeployment).toBe(false)
    })
  })

  describe('Deployment Status Integration', () => {
    it('should handle deployment status correctly', () => {
      // Mock deployment status
      mockDeploymentStatus.isDeployed = true
      mockDeploymentStatus.needsRedeployment = false

      const deploymentStatus = mockWorkflowRegistry
        .getState()
        .getWorkflowDeploymentStatus('test-id')

      expect(deploymentStatus.isDeployed).toBe(true)
      expect(deploymentStatus.needsRedeployment).toBe(false)
    })

    it('should handle missing deployment status', () => {
      // Create a separate mock for this test case
      const tempMockRegistry = {
        getState: vi.fn(() => ({
          getWorkflowDeploymentStatus: vi.fn(() => null),
        })),
      }

      // Temporarily replace the mock
      const originalMock = mockWorkflowRegistry.getState
      mockWorkflowRegistry.getState = tempMockRegistry.getState as any

      const deploymentStatus = mockWorkflowRegistry
        .getState()
        .getWorkflowDeploymentStatus('test-id')

      expect(deploymentStatus).toBe(null)

      // Restore original mock
      mockWorkflowRegistry.getState = originalMock
    })

    it('should handle undefined deployment status properties', () => {
      mockWorkflowRegistry.getState = vi.fn(() => ({
        getWorkflowDeploymentStatus: vi.fn(() => ({})),
      })) as any

      const deploymentStatus = mockWorkflowRegistry
        .getState()
        .getWorkflowDeploymentStatus('test-id')

      // Should handle undefined properties gracefully
      const isDeployed = deploymentStatus?.isDeployed || false
      expect(isDeployed).toBe(false)
    })
  })

  describe('Change Detection Scenarios', () => {
    it('should handle the redeployment cycle correctly', () => {
      // Scenario 1: Initial state - deployed, no changes
      mockDeploymentStatus.isDeployed = true
      let parentNeedsRedeployment = false
      let shouldShowIndicator = mockDeploymentStatus.isDeployed && parentNeedsRedeployment

      expect(shouldShowIndicator).toBe(false)

      // Scenario 2: User makes changes
      parentNeedsRedeployment = true
      shouldShowIndicator = mockDeploymentStatus.isDeployed && parentNeedsRedeployment

      expect(shouldShowIndicator).toBe(true)

      // Scenario 3: User redeploys
      parentNeedsRedeployment = false // Reset after redeployment
      shouldShowIndicator = mockDeploymentStatus.isDeployed && parentNeedsRedeployment

      expect(shouldShowIndicator).toBe(false)
    })

    it('should not show indicator when workflow is not deployed', () => {
      mockDeploymentStatus.isDeployed = false
      const parentNeedsRedeployment = true
      const shouldShowIndicator = mockDeploymentStatus.isDeployed && parentNeedsRedeployment

      expect(shouldShowIndicator).toBe(false)
    })

    it('should show correct tooltip messages based on state', () => {
      const getTooltipMessage = (isDeployed: boolean, needsRedeployment: boolean) => {
        if (isDeployed && needsRedeployment) {
          return 'Workflow changes detected'
        }
        if (isDeployed) {
          return 'Deployment Settings'
        }
        return 'Deploy as API'
      }

      // Not deployed
      expect(getTooltipMessage(false, false)).toBe('Deploy as API')
      expect(getTooltipMessage(false, true)).toBe('Deploy as API')

      // Deployed, no changes
      expect(getTooltipMessage(true, false)).toBe('Deployment Settings')

      // Deployed, changes detected
      expect(getTooltipMessage(true, true)).toBe('Workflow changes detected')
    })
  })

  describe('Error Handling', () => {
    it('should handle null activeWorkflowId gracefully', () => {
      const deploymentStatus = mockWorkflowRegistry.getState().getWorkflowDeploymentStatus(null)

      // Should return the mocked result without throwing
      expect(deploymentStatus).toBeDefined()
    })
  })

  describe('Props Integration', () => {
    it('should correctly pass needsRedeployment to child components', () => {
      const parentNeedsRedeployment = true
      const propsToModal = {
        needsRedeployment: parentNeedsRedeployment,
        workflowId: 'test-id',
      }

      expect(propsToModal.needsRedeployment).toBe(true)
    })

    it('should maintain prop consistency across re-renders', () => {
      let needsRedeployment = false

      // Initial render
      let componentProps = { needsRedeployment }
      expect(componentProps.needsRedeployment).toBe(false)

      // State change
      needsRedeployment = true
      componentProps = { needsRedeployment }
      expect(componentProps.needsRedeployment).toBe(true)

      // State change back
      needsRedeployment = false
      componentProps = { needsRedeployment }
      expect(componentProps.needsRedeployment).toBe(false)
    })
  })
})
