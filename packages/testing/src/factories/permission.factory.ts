import { nanoid } from 'nanoid'

/**
 * Permission types in order of access level (highest to lowest).
 */
export type PermissionType = 'admin' | 'write' | 'read'

/**
 * Entity types that can have permissions.
 */
export type EntityType = 'workspace' | 'workflow' | 'organization'

/**
 * Permission record as stored in the database.
 */
export interface Permission {
  id: string
  userId: string
  entityType: EntityType
  entityId: string
  permissionType: PermissionType
  createdAt: Date
}

/**
 * Options for creating a permission.
 */
export interface PermissionFactoryOptions {
  id?: string
  userId?: string
  entityType?: EntityType
  entityId?: string
  permissionType?: PermissionType
  createdAt?: Date
}

/**
 * Creates a mock permission record.
 */
export function createPermission(options: PermissionFactoryOptions = {}): Permission {
  return {
    id: options.id ?? nanoid(8),
    userId: options.userId ?? `user-${nanoid(6)}`,
    entityType: options.entityType ?? 'workspace',
    entityId: options.entityId ?? `ws-${nanoid(6)}`,
    permissionType: options.permissionType ?? 'read',
    createdAt: options.createdAt ?? new Date(),
  }
}

/**
 * Creates a workspace admin permission.
 */
export function createAdminPermission(
  userId: string,
  workspaceId: string,
  options: Partial<PermissionFactoryOptions> = {}
): Permission {
  return createPermission({
    userId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
    ...options,
  })
}

/**
 * Creates a workspace write permission.
 */
export function createWritePermission(
  userId: string,
  workspaceId: string,
  options: Partial<PermissionFactoryOptions> = {}
): Permission {
  return createPermission({
    userId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'write',
    ...options,
  })
}

/**
 * Creates a workspace read permission.
 */
export function createReadPermission(
  userId: string,
  workspaceId: string,
  options: Partial<PermissionFactoryOptions> = {}
): Permission {
  return createPermission({
    userId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'read',
    ...options,
  })
}

/**
 * Workspace record for testing.
 */
export interface WorkspaceRecord {
  id: string
  name: string
  ownerId: string
  billedAccountUserId?: string
  createdAt: Date
}

/**
 * Options for creating a workspace.
 */
export interface WorkspaceRecordFactoryOptions {
  id?: string
  name?: string
  ownerId?: string
  billedAccountUserId?: string
  createdAt?: Date
}

/**
 * Creates a mock workspace record.
 */
export function createWorkspaceRecord(
  options: WorkspaceRecordFactoryOptions = {}
): WorkspaceRecord {
  const id = options.id ?? `ws-${nanoid(6)}`
  const ownerId = options.ownerId ?? `user-${nanoid(6)}`
  return {
    id,
    name: options.name ?? `Workspace ${id}`,
    ownerId,
    billedAccountUserId: options.billedAccountUserId ?? ownerId,
    createdAt: options.createdAt ?? new Date(),
  }
}

/**
 * Workflow record for testing.
 */
export interface WorkflowRecord {
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
export interface WorkflowRecordFactoryOptions {
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
  const id = options.id ?? `wf-${nanoid(6)}`
  return {
    id,
    name: options.name ?? `Workflow ${id}`,
    userId: options.userId ?? `user-${nanoid(6)}`,
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
export interface MockSession {
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
export interface SessionFactoryOptions {
  userId?: string
  email?: string
  name?: string
  expiresAt?: Date
}

/**
 * Creates a mock session object.
 */
export function createSession(options: SessionFactoryOptions = {}): MockSession {
  const userId = options.userId ?? `user-${nanoid(6)}`
  return {
    user: {
      id: userId,
      email: options.email ?? `${userId}@test.com`,
      name: options.name,
    },
    expiresAt: options.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
  }
}

/**
 * Workflow access context for testing.
 */
export interface WorkflowAccessContext {
  workflow: WorkflowRecord
  workspaceOwnerId: string | null
  workspacePermission: PermissionType | null
  isOwner: boolean
  isWorkspaceOwner: boolean
}

/**
 * Creates a mock workflow access context.
 */
export function createWorkflowAccessContext(options: {
  workflow: WorkflowRecord
  workspaceOwnerId?: string | null
  workspacePermission?: PermissionType | null
  userId?: string
}): WorkflowAccessContext {
  const { workflow, workspaceOwnerId = null, workspacePermission = null, userId } = options

  return {
    workflow,
    workspaceOwnerId,
    workspacePermission,
    isOwner: userId ? workflow.userId === userId : false,
    isWorkspaceOwner: userId && workspaceOwnerId ? workspaceOwnerId === userId : false,
  }
}

/**
 * All socket operations that can be performed.
 */
export const SOCKET_OPERATIONS = [
  'add',
  'remove',
  'batch-add-blocks',
  'batch-remove-blocks',
  'update',
  'update-position',
  'update-name',
  'toggle-enabled',
  'update-parent',
  'update-wide',
  'update-advanced-mode',
  'update-trigger-mode',
  'toggle-handles',
  'batch-update-positions',
  'replace-state',
] as const

export type SocketOperation = (typeof SOCKET_OPERATIONS)[number]

/**
 * Operations allowed for each role.
 */
export const ROLE_ALLOWED_OPERATIONS: Record<PermissionType, SocketOperation[]> = {
  admin: [...SOCKET_OPERATIONS],
  write: [...SOCKET_OPERATIONS],
  read: ['update-position', 'batch-update-positions'],
}

/**
 * API key formats for testing.
 */
export interface ApiKeyTestData {
  plainKey: string
  encryptedStorage: string
  last4: string
}

/**
 * Creates test API key data.
 */
export function createLegacyApiKey(): { key: string; prefix: string } {
  const random = nanoid(24)
  return {
    key: `sim_${random}`,
    prefix: 'sim_',
  }
}

/**
 * Creates test encrypted format API key data.
 */
export function createEncryptedApiKey(): { key: string; prefix: string } {
  const random = nanoid(24)
  return {
    key: `sk-sim-${random}`,
    prefix: 'sk-sim-',
  }
}
