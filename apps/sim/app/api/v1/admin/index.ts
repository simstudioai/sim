/**
 * Admin API v1
 *
 * A RESTful API for administrative operations on Sim.
 *
 * Authentication:
 *   Set ADMIN_API_KEY environment variable and use x-admin-key header.
 *
 * Endpoints:
 *
 *   Users:
 *   GET    /api/v1/admin/users                              - List all users
 *   GET    /api/v1/admin/users/:id                          - Get user details
 *   GET    /api/v1/admin/users/:id/billing                  - Get user billing info
 *   PATCH  /api/v1/admin/users/:id/billing                  - Update user billing (limit, blocked)
 *
 *   Workspaces:
 *   GET    /api/v1/admin/workspaces                         - List all workspaces
 *   GET    /api/v1/admin/workspaces/:id                     - Get workspace details
 *   GET    /api/v1/admin/workspaces/:id/members             - List workspace members
 *   POST   /api/v1/admin/workspaces/:id/members             - Add/update workspace member
 *   DELETE /api/v1/admin/workspaces/:id/members?userId=X    - Remove workspace member
 *   GET    /api/v1/admin/workspaces/:id/members/:mid        - Get workspace member details
 *   PATCH  /api/v1/admin/workspaces/:id/members/:mid        - Update workspace member permissions
 *   DELETE /api/v1/admin/workspaces/:id/members/:mid        - Remove workspace member by ID
 *   GET    /api/v1/admin/workspaces/:id/workflows           - List workspace workflows
 *   DELETE /api/v1/admin/workspaces/:id/workflows           - Delete all workspace workflows
 *   GET    /api/v1/admin/workspaces/:id/folders             - List workspace folders
 *   GET    /api/v1/admin/workspaces/:id/export              - Export workspace (ZIP/JSON)
 *   POST   /api/v1/admin/workspaces/:id/import              - Import into workspace
 *
 *   Workflows:
 *   GET    /api/v1/admin/workflows                          - List all workflows
 *   GET    /api/v1/admin/workflows/:id                      - Get workflow details
 *   DELETE /api/v1/admin/workflows/:id                      - Delete workflow
 *   GET    /api/v1/admin/workflows/:id/export               - Export workflow (JSON)
 *   POST   /api/v1/admin/workflows/export                   - Export multiple workflows (ZIP/JSON)
 *   POST   /api/v1/admin/workflows/import                   - Import single workflow
 *   POST   /api/v1/admin/workflows/:id/deploy               - Deploy workflow
 *   DELETE /api/v1/admin/workflows/:id/deploy               - Undeploy workflow
 *   GET    /api/v1/admin/workflows/:id/versions             - List deployment versions
 *   POST   /api/v1/admin/workflows/:id/versions/:vid/activate - Activate specific version
 *
 *   Folders:
 *   GET    /api/v1/admin/folders/:id/export                 - Export folder with contents (ZIP/JSON)
 *
 *   Organizations:
 *   GET    /api/v1/admin/organizations                      - List all organizations
 *   POST   /api/v1/admin/organizations                      - Create organization (requires ownerId)
 *   GET    /api/v1/admin/organizations/:id                  - Get organization details
 *   PATCH  /api/v1/admin/organizations/:id                  - Update organization
 *   GET    /api/v1/admin/organizations/:id/members          - List organization members
 *   POST   /api/v1/admin/organizations/:id/members          - Add/update member (validates seat availability)
 *   GET    /api/v1/admin/organizations/:id/members/:mid     - Get member details
 *   PATCH  /api/v1/admin/organizations/:id/members/:mid     - Update member role
 *   DELETE /api/v1/admin/organizations/:id/members/:mid     - Remove member
 *   GET    /api/v1/admin/organizations/:id/billing          - Get org billing summary
 *   PATCH  /api/v1/admin/organizations/:id/billing          - Update org usage limit
 *   GET    /api/v1/admin/organizations/:id/seats            - Get seat analytics
 *
 *   Subscriptions:
 *   GET    /api/v1/admin/subscriptions                      - List all subscriptions
 *   GET    /api/v1/admin/subscriptions/:id                  - Get subscription details
 *   DELETE /api/v1/admin/subscriptions/:id                  - Cancel subscription (?atPeriodEnd=true for scheduled)
 *
 *   Credits:
 *   POST   /api/v1/admin/credits                            - Issue credits to user (by userId or email)
 *
 *   Access Control (Permission Groups):
 *   GET    /api/v1/admin/access-control                     - List permission groups (?organizationId=X)
 *   DELETE /api/v1/admin/access-control                     - Delete permission groups for org (?organizationId=X)
 */

export type { AdminAuthFailure, AdminAuthResult, AdminAuthSuccess } from '@/app/api/v1/admin/auth'
export { authenticateAdminRequest } from '@/app/api/v1/admin/auth'
export type { AdminRouteHandler, AdminRouteHandlerWithParams } from '@/app/api/v1/admin/middleware'
export { withAdminAuth, withAdminAuthParams } from '@/app/api/v1/admin/middleware'
export {
  badRequestResponse,
  errorResponse,
  forbiddenResponse,
  internalErrorResponse,
  listResponse,
  notConfiguredResponse,
  notFoundResponse,
  singleResponse,
  unauthorizedResponse,
} from '@/app/api/v1/admin/responses'
export type {
  AdminDeploymentVersion,
  AdminDeployResult,
  AdminErrorResponse,
  AdminFolder,
  AdminListResponse,
  AdminMember,
  AdminMemberDetail,
  AdminOrganization,
  AdminOrganizationBillingSummary,
  AdminOrganizationDetail,
  AdminSeatAnalytics,
  AdminSingleResponse,
  AdminSubscription,
  AdminUndeployResult,
  AdminUser,
  AdminUserBilling,
  AdminUserBillingWithSubscription,
  AdminWorkflow,
  AdminWorkflowDetail,
  AdminWorkspace,
  AdminWorkspaceDetail,
  AdminWorkspaceMember,
  DbMember,
  DbOrganization,
  DbSubscription,
  DbUser,
  DbUserStats,
  DbWorkflow,
  DbWorkflowFolder,
  DbWorkspace,
  FolderExportPayload,
  ImportResult,
  PaginationMeta,
  PaginationParams,
  VariableType,
  WorkflowExportPayload,
  WorkflowExportState,
  WorkflowImportRequest,
  WorkflowVariable,
  WorkspaceExportPayload,
  WorkspaceImportRequest,
  WorkspaceImportResponse,
} from '@/app/api/v1/admin/types'
export {
  createPaginationMeta,
  DEFAULT_LIMIT,
  extractWorkflowMetadata,
  MAX_LIMIT,
  parsePaginationParams,
  parseWorkflowVariables,
  toAdminFolder,
  toAdminOrganization,
  toAdminSubscription,
  toAdminUser,
  toAdminWorkflow,
  toAdminWorkspace,
} from '@/app/api/v1/admin/types'
