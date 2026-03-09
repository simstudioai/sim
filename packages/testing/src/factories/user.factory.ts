import type { User, Workflow, WorkflowState, Workspace } from '../types'
import { createWorkflowState } from './workflow.factory'

/**
 * Options for creating a mock user.
 */
export interface UserFactoryOptions {
  id?: string
  email?: string
  name?: string
  image?: string
}

/**
 * Creates a mock user.
 *
 * @example
 * ```ts
 * const user = createUser({ email: 'test@example.com' })
 * ```
 */
export function createUser(options: UserFactoryOptions = {}): User {
  const id = options.id ?? `user-${Math.random().toString(36).substring(2, 10)}`
  return {
    id,
    email: options.email ?? `${id}@test.example.com`,
    name: options.name ?? `Test User ${id.substring(0, 4)}`,
    image: options.image,
  }
}

/**
 * Options for creating a mock workspace.
 */
export interface WorkspaceFactoryOptions {
  id?: string
  name?: string
  ownerId?: string
  createdAt?: Date
  updatedAt?: Date
}

/**
 * Creates a mock workspace.
 *
 * @example
 * ```ts
 * const workspace = createWorkspace({ name: 'My Workspace' })
 * ```
 */
export function createWorkspace(options: WorkspaceFactoryOptions = {}): Workspace {
  const now = new Date()
  return {
    id: options.id ?? `ws-${Math.random().toString(36).substring(2, 10)}`,
    name: options.name ?? 'Test Workspace',
    ownerId: options.ownerId ?? `user-${Math.random().toString(36).substring(2, 10)}`,
    createdAt: options.createdAt ?? now,
    updatedAt: options.updatedAt ?? now,
  }
}

/**
 * Options for creating a mock workflow.
 */
export interface WorkflowObjectFactoryOptions {
  id?: string
  name?: string
  workspaceId?: string
  state?: WorkflowState
  createdAt?: Date
  updatedAt?: Date
  isDeployed?: boolean
}

/**
 * Creates a mock workflow object (not just state).
 *
 * @example
 * ```ts
 * const workflow = createWorkflow({ name: 'My Workflow' })
 * ```
 */
export function createWorkflow(options: WorkflowObjectFactoryOptions = {}): Workflow {
  const now = new Date()
  return {
    id: options.id ?? `wf-${Math.random().toString(36).substring(2, 10)}`,
    name: options.name ?? 'Test Workflow',
    workspaceId: options.workspaceId ?? `ws-${Math.random().toString(36).substring(2, 10)}`,
    state: options.state ?? createWorkflowState(),
    createdAt: options.createdAt ?? now,
    updatedAt: options.updatedAt ?? now,
    isDeployed: options.isDeployed ?? false,
  }
}

/**
 * Creates a user with an associated workspace.
 *
 * @example
 * ```ts
 * const { user, workspace } = createUserWithWorkspace()
 * ```
 */
export function createUserWithWorkspace(
  userOptions: UserFactoryOptions = {},
  workspaceOptions: Omit<WorkspaceFactoryOptions, 'ownerId'> = {}
): { user: User; workspace: Workspace } {
  const user = createUser(userOptions)
  const workspace = createWorkspace({
    ...workspaceOptions,
    ownerId: user.id,
  })
  return { user, workspace }
}
