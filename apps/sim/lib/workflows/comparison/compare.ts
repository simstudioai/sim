import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { normalizedStringify, normalizeWorkflowState } from './normalize'

/**
 * Compare the current workflow state with the deployed state to detect meaningful changes.
 * Uses the shared normalizeWorkflowState function to ensure consistency with snapshot hashing.
 *
 * @param currentState - The current workflow state
 * @param deployedState - The deployed workflow state
 * @returns True if there are meaningful changes, false if only position changes or no changes
 */
export function hasWorkflowChanged(
  currentState: WorkflowState,
  deployedState: WorkflowState | null
): boolean {
  // If no deployed state exists, then the workflow has changed
  if (!deployedState) return true

  const normalizedCurrent = normalizeWorkflowState(currentState)
  const normalizedDeployed = normalizeWorkflowState(deployedState)

  return normalizedStringify(normalizedCurrent) !== normalizedStringify(normalizedDeployed)
}
