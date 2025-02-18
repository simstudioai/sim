import { WorkflowMetadata } from './types'

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
