/**
 * @vitest-environment node
 *
 * Failure mode: signing out leaves the previous user's open workflow, its block values or the active
 * workflow in memory, because a workflow store stopped registering its identity reset.
 */
import { describe, expect, it } from 'vitest'
import { resetRegisteredUserData } from '@/stores/user-data-reset-registry'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

describe('workflow store identity resets', () => {
  it("clears the previous user's workflow state when user data resets", () => {
    useWorkflowRegistry.setState({ activeWorkflowId: 'workflow-a' })
    useWorkflowStore.setState({ currentWorkflowId: 'workflow-a' })
    useSubBlockStore.setState({ workflowValues: { 'workflow-a': {} } })

    resetRegisteredUserData()

    expect(useWorkflowRegistry.getState().activeWorkflowId).toBeNull()
    expect(useWorkflowStore.getState().currentWorkflowId).toBeNull()
    expect(useSubBlockStore.getState().workflowValues).toEqual({})
  })
})
