/**
 * Admin API Types
 *
 * This file defines the types for the Admin API endpoints.
 * All responses follow a consistent structure for predictability.
 */

import type {
  member,
  organization,
  subscription,
  user,
  userStats,
  workflow,
  workflowFolder,
  workspace,
} from '@sim/db/schema'
import type { InferSelectModel } from 'drizzle-orm'
import type { Edge } from 'reactflow'
import type { BlockState, Loop, Parallel } from '@/stores/workflows/workflow/types'

// =============================================================================
// Database Model Types (inferred from schema)
// =============================================================================

export type DbUser = InferSelectModel<typeof user>
export type DbWorkspace = InferSelectModel<typeof workspace>
export type DbWorkflow = InferSelectModel<typeof workflow>
export type DbWorkflowFolder = InferSelectModel<typeof workflowFolder>
export type DbOrganization = InferSelectModel<typeof organization>
export type DbSubscription = InferSelectModel<typeof subscription>
export type DbMember = InferSelectModel<typeof member>
export type DbUserStats = InferSelectModel<typeof userStats>

// =============================================================================
// Pagination
// =============================================================================

export interface PaginationParams {
  limit: number
  offset: number
}

export interface PaginationMeta {
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 250

export function parsePaginationParams(url: URL): PaginationParams {
  const limitParam = url.searchParams.get('limit')
  const offsetParam = url.searchParams.get('offset')

  let limit = limitParam ? Number.parseInt(limitParam, 10) : DEFAULT_LIMIT
  let offset = offsetParam ? Number.parseInt(offsetParam, 10) : 0

  if (Number.isNaN(limit) || limit < 1) limit = DEFAULT_LIMIT
  if (limit > MAX_LIMIT) limit = MAX_LIMIT
  if (Number.isNaN(offset) || offset < 0) offset = 0

  return { limit, offset }
}

export function createPaginationMeta(total: number, limit: number, offset: number): PaginationMeta {
  return {
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  }
}

// =============================================================================
// API Response Types
// =============================================================================

export interface AdminListResponse<T> {
  data: T[]
  pagination: PaginationMeta
}

export interface AdminSingleResponse<T> {
  data: T
}

export interface AdminErrorResponse {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

// =============================================================================
// User Types
// =============================================================================

export interface AdminUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  createdAt: string
  updatedAt: string
}

export function toAdminUser(dbUser: DbUser): AdminUser {
  return {
    id: dbUser.id,
    name: dbUser.name,
    email: dbUser.email,
    emailVerified: dbUser.emailVerified,
    image: dbUser.image,
    createdAt: dbUser.createdAt.toISOString(),
    updatedAt: dbUser.updatedAt.toISOString(),
  }
}

// =============================================================================
// Workspace Types
// =============================================================================

export interface AdminWorkspace {
  id: string
  name: string
  ownerId: string
  createdAt: string
  updatedAt: string
}

export interface AdminWorkspaceDetail extends AdminWorkspace {
  workflowCount: number
  folderCount: number
}

export function toAdminWorkspace(dbWorkspace: DbWorkspace): AdminWorkspace {
  return {
    id: dbWorkspace.id,
    name: dbWorkspace.name,
    ownerId: dbWorkspace.ownerId,
    createdAt: dbWorkspace.createdAt.toISOString(),
    updatedAt: dbWorkspace.updatedAt.toISOString(),
  }
}

// =============================================================================
// Folder Types
// =============================================================================

export interface AdminFolder {
  id: string
  name: string
  parentId: string | null
  color: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export function toAdminFolder(dbFolder: DbWorkflowFolder): AdminFolder {
  return {
    id: dbFolder.id,
    name: dbFolder.name,
    parentId: dbFolder.parentId,
    color: dbFolder.color,
    sortOrder: dbFolder.sortOrder,
    createdAt: dbFolder.createdAt.toISOString(),
    updatedAt: dbFolder.updatedAt.toISOString(),
  }
}

// =============================================================================
// Workflow Types
// =============================================================================

export interface AdminWorkflow {
  id: string
  name: string
  description: string | null
  color: string
  workspaceId: string | null
  folderId: string | null
  isDeployed: boolean
  deployedAt: string | null
  runCount: number
  lastRunAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AdminWorkflowDetail extends AdminWorkflow {
  blockCount: number
  edgeCount: number
}

export function toAdminWorkflow(dbWorkflow: DbWorkflow): AdminWorkflow {
  return {
    id: dbWorkflow.id,
    name: dbWorkflow.name,
    description: dbWorkflow.description,
    color: dbWorkflow.color,
    workspaceId: dbWorkflow.workspaceId,
    folderId: dbWorkflow.folderId,
    isDeployed: dbWorkflow.isDeployed,
    deployedAt: dbWorkflow.deployedAt?.toISOString() ?? null,
    runCount: dbWorkflow.runCount,
    lastRunAt: dbWorkflow.lastRunAt?.toISOString() ?? null,
    createdAt: dbWorkflow.createdAt.toISOString(),
    updatedAt: dbWorkflow.updatedAt.toISOString(),
  }
}

// =============================================================================
// Workflow Variable Types
// =============================================================================

export type VariableType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'plain'

export interface WorkflowVariable {
  id: string
  name: string
  type: VariableType
  value: unknown
}

// =============================================================================
// Export/Import Types
// =============================================================================

export interface WorkflowExportState {
  blocks: Record<string, BlockState>
  edges: Edge[]
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
  metadata?: {
    name?: string
    description?: string
    color?: string
    exportedAt?: string
  }
  variables?: Record<string, WorkflowVariable>
}

export interface WorkflowExportPayload {
  version: '1.0'
  exportedAt: string
  workflow: {
    id: string
    name: string
    description: string | null
    color: string
    workspaceId: string | null
    folderId: string | null
  }
  state: WorkflowExportState
}

export interface FolderExportPayload {
  id: string
  name: string
  parentId: string | null
}

export interface WorkspaceExportPayload {
  version: '1.0'
  exportedAt: string
  workspace: {
    id: string
    name: string
  }
  workflows: Array<{
    workflow: WorkflowExportPayload['workflow']
    state: WorkflowExportState
  }>
  folders: FolderExportPayload[]
}

// =============================================================================
// Import Types
// =============================================================================

export interface WorkflowImportRequest {
  workspaceId: string
  folderId?: string
  name?: string
  workflow: WorkflowExportPayload | WorkflowExportState | string
}

export interface WorkspaceImportRequest {
  workflows: Array<{
    content: string | WorkflowExportPayload | WorkflowExportState
    name?: string
    folderPath?: string[]
  }>
}

export interface ImportResult {
  workflowId: string
  name: string
  success: boolean
  error?: string
}

export interface WorkspaceImportResponse {
  imported: number
  failed: number
  results: ImportResult[]
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Parse workflow variables from database JSON format to Record format.
 * Handles both legacy Array and current Record<string, Variable> formats.
 */
export function parseWorkflowVariables(
  dbVariables: DbWorkflow['variables']
): Record<string, WorkflowVariable> | undefined {
  if (!dbVariables) return undefined

  try {
    const varsObj = typeof dbVariables === 'string' ? JSON.parse(dbVariables) : dbVariables

    // Handle legacy Array format by converting to Record
    if (Array.isArray(varsObj)) {
      const result: Record<string, WorkflowVariable> = {}
      for (const v of varsObj) {
        result[v.id] = {
          id: v.id,
          name: v.name,
          type: v.type,
          value: v.value,
        }
      }
      return result
    }

    // Already Record format - normalize and return
    if (typeof varsObj === 'object' && varsObj !== null) {
      const result: Record<string, WorkflowVariable> = {}
      for (const [key, v] of Object.entries(varsObj)) {
        const variable = v as { id: string; name: string; type: VariableType; value: unknown }
        result[key] = {
          id: variable.id,
          name: variable.name,
          type: variable.type,
          value: variable.value,
        }
      }
      return result
    }
  } catch {
    // pass
  }

  return undefined
}

/**
 * Extract workflow metadata from various export formats.
 * Handles both full export payload and raw state formats.
 */
export function extractWorkflowMetadata(
  workflowJson: unknown,
  overrideName?: string
): { name: string; color: string; description: string } {
  const defaults = {
    name: overrideName || 'Imported Workflow',
    color: '#3972F6',
    description: 'Imported via Admin API',
  }

  if (!workflowJson || typeof workflowJson !== 'object') {
    return defaults
  }

  const parsed = workflowJson as Record<string, unknown>

  const name =
    overrideName ||
    getNestedString(parsed, 'workflow.name') ||
    getNestedString(parsed, 'state.metadata.name') ||
    getNestedString(parsed, 'metadata.name') ||
    defaults.name

  const color =
    getNestedString(parsed, 'workflow.color') ||
    getNestedString(parsed, 'state.metadata.color') ||
    getNestedString(parsed, 'metadata.color') ||
    defaults.color

  const description =
    getNestedString(parsed, 'workflow.description') ||
    getNestedString(parsed, 'state.metadata.description') ||
    getNestedString(parsed, 'metadata.description') ||
    defaults.description

  return { name, color, description }
}

/**
 * Safely get a nested string value from an object.
 */
function getNestedString(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }

  return typeof current === 'string' ? current : undefined
}

// =============================================================================
// Organization Types
// =============================================================================

export interface AdminOrganization {
  id: string
  name: string
  slug: string
  logo: string | null
  orgUsageLimit: string | null
  storageUsedBytes: number
  departedMemberUsage: string
  createdAt: string
  updatedAt: string
}

export interface AdminOrganizationDetail extends AdminOrganization {
  memberCount: number
  subscription: AdminSubscription | null
}

export function toAdminOrganization(dbOrg: DbOrganization): AdminOrganization {
  return {
    id: dbOrg.id,
    name: dbOrg.name,
    slug: dbOrg.slug,
    logo: dbOrg.logo,
    orgUsageLimit: dbOrg.orgUsageLimit,
    storageUsedBytes: dbOrg.storageUsedBytes,
    departedMemberUsage: dbOrg.departedMemberUsage,
    createdAt: dbOrg.createdAt.toISOString(),
    updatedAt: dbOrg.updatedAt.toISOString(),
  }
}

// =============================================================================
// Subscription Types
// =============================================================================

export interface AdminSubscription {
  id: string
  plan: string
  referenceId: string
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  status: string | null
  periodStart: string | null
  periodEnd: string | null
  cancelAtPeriodEnd: boolean | null
  seats: number | null
  trialStart: string | null
  trialEnd: string | null
  metadata: unknown
}

export function toAdminSubscription(dbSub: DbSubscription): AdminSubscription {
  return {
    id: dbSub.id,
    plan: dbSub.plan,
    referenceId: dbSub.referenceId,
    stripeCustomerId: dbSub.stripeCustomerId,
    stripeSubscriptionId: dbSub.stripeSubscriptionId,
    status: dbSub.status,
    periodStart: dbSub.periodStart?.toISOString() ?? null,
    periodEnd: dbSub.periodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: dbSub.cancelAtPeriodEnd,
    seats: dbSub.seats,
    trialStart: dbSub.trialStart?.toISOString() ?? null,
    trialEnd: dbSub.trialEnd?.toISOString() ?? null,
    metadata: dbSub.metadata,
  }
}

// =============================================================================
// Member Types
// =============================================================================

export interface AdminMember {
  id: string
  userId: string
  organizationId: string
  role: string
  createdAt: string
  // Joined user info
  userName: string
  userEmail: string
}

export interface AdminMemberDetail extends AdminMember {
  // Billing/usage info from userStats
  currentPeriodCost: string
  currentUsageLimit: string | null
  lastActive: string | null
  billingBlocked: boolean
}

// =============================================================================
// Workspace Member Types
// =============================================================================

export interface AdminWorkspaceMember {
  id: string
  workspaceId: string
  userId: string
  permissions: 'admin' | 'write' | 'read'
  createdAt: string
  updatedAt: string
  userName: string
  userEmail: string
  userImage: string | null
}

// =============================================================================
// User Billing Types
// =============================================================================

export interface AdminUserBilling {
  userId: string
  // User info
  userName: string
  userEmail: string
  stripeCustomerId: string | null
  // Usage stats
  totalManualExecutions: number
  totalApiCalls: number
  totalWebhookTriggers: number
  totalScheduledExecutions: number
  totalChatExecutions: number
  totalMcpExecutions: number
  totalA2aExecutions: number
  totalTokensUsed: number
  totalCost: string
  currentUsageLimit: string | null
  currentPeriodCost: string
  lastPeriodCost: string | null
  billedOverageThisPeriod: string
  storageUsedBytes: number
  lastActive: string | null
  billingBlocked: boolean
  // Copilot usage
  totalCopilotCost: string
  currentPeriodCopilotCost: string
  lastPeriodCopilotCost: string | null
  totalCopilotTokens: number
  totalCopilotCalls: number
}

export interface AdminUserBillingWithSubscription extends AdminUserBilling {
  subscriptions: AdminSubscription[]
  organizationMemberships: Array<{
    organizationId: string
    organizationName: string
    role: string
  }>
}

// =============================================================================
// Organization Billing Summary Types
// =============================================================================

export interface AdminOrganizationBillingSummary {
  organizationId: string
  organizationName: string
  subscriptionPlan: string
  subscriptionStatus: string
  // Seats
  totalSeats: number
  usedSeats: number
  availableSeats: number
  // Usage
  totalCurrentUsage: number
  totalUsageLimit: number
  minimumBillingAmount: number
  averageUsagePerMember: number
  usagePercentage: number
  // Billing period
  billingPeriodStart: string | null
  billingPeriodEnd: string | null
  // Alerts
  membersOverLimit: number
  membersNearLimit: number
}

export interface AdminSeatAnalytics {
  organizationId: string
  organizationName: string
  currentSeats: number
  maxSeats: number
  availableSeats: number
  subscriptionPlan: string
  canAddSeats: boolean
  utilizationRate: number
  activeMembers: number
  inactiveMembers: number
  memberActivity: Array<{
    userId: string
    userName: string
    userEmail: string
    role: string
    joinedAt: string
    lastActive: string | null
  }>
}

export interface AdminDeploymentVersion {
  id: string
  version: number
  name: string | null
  isActive: boolean
  createdAt: string
  createdBy: string | null
  deployedByName: string | null
}

export interface AdminDeployResult {
  isDeployed: boolean
  version: number
  deployedAt: string
  warnings?: string[]
}

export interface AdminUndeployResult {
  isDeployed: boolean
}
