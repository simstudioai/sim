import { defineWorkspaceOperation } from '@/lib/core/application'

const MEMORY_EXECUTOR_PRINCIPAL_POLICY = {
  principalKinds: [],
  workflowExecution: 'allow',
} as const

function readOperation<const Id extends string>(id: Id) {
  return defineWorkspaceOperation({
    id,
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    ...MEMORY_EXECUTOR_PRINCIPAL_POLICY,
  })
}

function writeOperation<const Id extends string>(id: Id) {
  return defineWorkspaceOperation({
    id,
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    ...MEMORY_EXECUTOR_PRINCIPAL_POLICY,
  })
}

export const memoryOperations = {
  list: readOperation('memory.list'),
  read: readOperation('memory.read'),
  append: writeOperation('memory.append'),
  delete: writeOperation('memory.delete'),
} as const
