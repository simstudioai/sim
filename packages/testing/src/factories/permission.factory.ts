import { shortId } from './id'

/**
 * Workflow record for testing.
 */
interface WorkflowRecord {
  id: string
  name: string
  userId: string
  workspaceId: string | null
  state: string
  isDeployed: boolean
  runCount: number
  createdAt: Date
}

/**
 * Options for creating a workflow record.
 */
interface WorkflowRecordFactoryOptions {
  id?: string
  name?: string
  userId?: string
  workspaceId?: string | null
  state?: string
  isDeployed?: boolean
  runCount?: number
  createdAt?: Date
}

/**
 * Creates a mock workflow database record.
 */
export function createWorkflowRecord(options: WorkflowRecordFactoryOptions = {}): WorkflowRecord {
  const id = options.id ?? `wf-${shortId(6)}`
  return {
    id,
    name: options.name ?? `Workflow ${id}`,
    userId: options.userId ?? `user-${shortId(6)}`,
    workspaceId: options.workspaceId ?? null,
    state: options.state ?? '{}',
    isDeployed: options.isDeployed ?? false,
    runCount: options.runCount ?? 0,
    createdAt: options.createdAt ?? new Date(),
  }
}

/**
 * Session object for testing.
 */
interface MockSession {
  user: {
    id: string
    email: string
    name?: string
  }
  expiresAt: Date
}

/**
 * Options for creating a session.
 */
interface SessionFactoryOptions {
  userId?: string
  email?: string
  name?: string
  expiresAt?: Date
}

/**
 * Creates a mock session object.
 */
export function createSession(options: SessionFactoryOptions = {}): MockSession {
  const userId = options.userId ?? `user-${shortId(6)}`
  return {
    user: {
      id: userId,
      email: options.email ?? `${userId}@test.com`,
      name: options.name,
    },
    expiresAt: options.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
  }
}
