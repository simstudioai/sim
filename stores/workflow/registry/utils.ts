import { WorkflowMetadata } from './types'

// Available workflow colors
export const WORKFLOW_COLORS = ['#3972F6', '#F639DD', '#F6B539', '#8139F6', '#F64439']

// Generates a unique name for a new workflow
export function generateUniqueName(existingWorkflows: Record<string, WorkflowMetadata>): string {
  // Extract numbers from existing workflow names using regex
  const numbers = Object.values(existingWorkflows)
    .map((w) => {
      const match = w.name.match(/Workflow (\d+)/)
      return match ? parseInt(match[1]) : 0
    })
    .filter((n) => n > 0)

  if (numbers.length === 0) {
    return 'Workflow 1'
  }

  // Find the maximum number and add 1
  const nextNumber = Math.max(...numbers) + 1
  return `Workflow ${nextNumber}`
}

// Determines the next color to use for a new workflow based on the last used color
export function getNextWorkflowColor(existingWorkflows: Record<string, WorkflowMetadata>): string {
  const workflowArray = Object.values(existingWorkflows)

  if (workflowArray.length === 0) {
    return WORKFLOW_COLORS[0]
  }

  const lastWorkflow = workflowArray[workflowArray.length - 1]

  // Find the index of the last used color, defaulting to first color if undefined
  const lastColorIndex = lastWorkflow?.color ? WORKFLOW_COLORS.indexOf(lastWorkflow.color) : -1

  // Get next color index, wrapping around to 0 if we reach the end
  const nextColorIndex = (lastColorIndex + 1) % WORKFLOW_COLORS.length

  return WORKFLOW_COLORS[nextColorIndex]
}
