/**
 * Admin API v1
 *
 * A RESTful API for administrative operations on Sim.
 *
 * Authentication:
 *   Set ADMIN_API_KEY environment variable and use x-admin-key header.
 *
 * Endpoints:
 *   GET    /api/v1/admin/users                    - List all users
 *   GET    /api/v1/admin/users/:id                - Get user details
 *   GET    /api/v1/admin/workspaces               - List all workspaces
 *   GET    /api/v1/admin/workspaces/:id           - Get workspace details
 *   GET    /api/v1/admin/workspaces/:id/workflows - List workspace workflows
 *   DELETE /api/v1/admin/workspaces/:id/workflows - Delete all workspace workflows
 *   GET    /api/v1/admin/workspaces/:id/folders   - List workspace folders
 *   GET    /api/v1/admin/workspaces/:id/export    - Export workspace (ZIP/JSON)
 *   POST   /api/v1/admin/workspaces/:id/import    - Import into workspace
 *   GET    /api/v1/admin/workflows                - List all workflows
 *   GET    /api/v1/admin/workflows/:id            - Get workflow details
 *   DELETE /api/v1/admin/workflows/:id            - Delete workflow
 *   GET    /api/v1/admin/workflows/:id/export     - Export workflow (JSON)
 *   POST   /api/v1/admin/workflows/import         - Import single workflow
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
  AdminErrorResponse,
  AdminFolder,
  AdminListResponse,
  AdminSingleResponse,
  AdminUser,
  AdminWorkflow,
  AdminWorkflowDetail,
  AdminWorkspace,
  AdminWorkspaceDetail,
  DbUser,
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
  toAdminUser,
  toAdminWorkflow,
  toAdminWorkspace,
} from '@/app/api/v1/admin/types'
