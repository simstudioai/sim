import { WorkflowMetadata } from './types'

// Available workflow colors
export const WORKFLOW_COLORS = [
  '#3972F6',
  '#F639DD',
  '#F6B539',
  '#8139F6',
  '#39B54A',
  '#39B5AB',
  '#F66839',
]

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

// Determines the next color to use for a new workflow based on the color of the newest workflow
export function getNextWorkflowColor(existingWorkflows: Record<string, WorkflowMetadata>): string {
  const workflowArray = Object.values(existingWorkflows)

  if (workflowArray.length === 0) {
    return WORKFLOW_COLORS[0]
  }

  // Sort workflows by lastModified date (newest first)
  const sortedWorkflows = [...workflowArray].sort((a, b) => {
    const dateA =
      a.lastModified instanceof Date ? a.lastModified.getTime() : new Date(a.lastModified).getTime()
    const dateB =
      b.lastModified instanceof Date ? b.lastModified.getTime() : new Date(b.lastModified).getTime()
    return dateB - dateA
  })

  // Get the newest workflow (first in sorted array)
  const newestWorkflow = sortedWorkflows[0]

  // Find the index of the newest workflow's color, defaulting to -1 if undefined
  const currentColorIndex = newestWorkflow?.color
    ? WORKFLOW_COLORS.indexOf(newestWorkflow.color)
    : -1

  // Get next color index, wrapping around to 0 if we reach the end
  const nextColorIndex = (currentColorIndex + 1) % WORKFLOW_COLORS.length

  return WORKFLOW_COLORS[nextColorIndex]
}
