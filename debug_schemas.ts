import { WorkflowOperationSchema } from './apps/sim/socket/validation/schemas'

console.log('WorkflowOperationSchema:', !!WorkflowOperationSchema)
if (
  WorkflowOperationSchema &&
  WorkflowOperationSchema._def &&
  WorkflowOperationSchema._def.options
) {
  WorkflowOperationSchema._def.options.forEach((opt, i) => {
    console.log(`Option ${i}:`, !!opt)
  })
}
