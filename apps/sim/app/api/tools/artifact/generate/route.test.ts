/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns, workflowAuthzMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockExecuteProviderRequest,
  mockGetProviderFromModel,
  mockUploadWorkspaceFile,
  mockEnsureFolderPath,
  mockUpsertFileShare,
  mockResolveBillingAttribution,
  mockCheckAttributedUsageLimits,
  mockRecordUsage,
  mockCheckAndBillPayerOverageThreshold,
  mockAssertPermissionsAllowed,
  mockValidatePublicFileSharing,
} = vi.hoisted(() => ({
  mockExecuteProviderRequest: vi.fn(),
  mockGetProviderFromModel: vi.fn(() => 'anthropic'),
  mockUploadWorkspaceFile: vi.fn(),
  mockEnsureFolderPath: vi.fn(),
  mockUpsertFileShare: vi.fn(),
  mockResolveBillingAttribution: vi.fn(),
  mockCheckAttributedUsageLimits: vi.fn(),
  mockRecordUsage: vi.fn(),
  mockCheckAndBillPayerOverageThreshold: vi.fn(),
  mockAssertPermissionsAllowed: vi.fn(),
  mockValidatePublicFileSharing: vi.fn(),
}))

vi.mock('@/providers', () => ({
  executeProviderRequest: mockExecuteProviderRequest,
}))

vi.mock('@/providers/utils', () => ({
  getProviderFromModel: mockGetProviderFromModel,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  uploadWorkspaceFile: mockUploadWorkspaceFile,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  ensureWorkspaceFileFolderPath: mockEnsureFolderPath,
}))

vi.mock('@/lib/public-shares/share-manager', () => ({
  ShareValidationError: class ShareValidationError extends Error {},
  upsertFileShare: mockUpsertFileShare,
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  checkAttributedUsageLimits: mockCheckAttributedUsageLimits,
  requireBillingAttributionHeader: vi.fn(),
  resolveBillingAttribution: mockResolveBillingAttribution,
  toBillingContext: vi.fn(() => ({})),
}))

vi.mock('@/lib/billing/threshold-billing', () => ({
  checkAndBillPayerOverageThreshold: mockCheckAndBillPayerOverageThreshold,
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  recordUsage: mockRecordUsage,
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  assertPermissionsAllowed: mockAssertPermissionsAllowed,
  ModelNotAllowedError: class ModelNotAllowedError extends Error {},
  ProviderNotAllowedError: class ProviderNotAllowedError extends Error {},
  PublicFileSharingNotAllowedError: class PublicFileSharingNotAllowedError extends Error {},
  validatePublicFileSharing: mockValidatePublicFileSharing,
}))

vi.mock('@/app/api/auth/oauth/utils', () => ({
  refreshTokenIfNeeded: vi.fn(),
}))

import { POST } from '@/app/api/tools/artifact/generate/route'

const mockAuth = hybridAuthMockFns.mockCheckSessionOrInternalAuth
const mockAuthorizeWorkflow = workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission

const VALID_HTML = '<!DOCTYPE html><html><head><title>t</title></head><body>hi</body></html>'

const UPLOADED_FILE = {
  id: 'wf_file1',
  name: 'report.html',
  size: VALID_HTML.length,
  type: 'text/html',
  url: '/api/files/serve/key1?context=workspace',
  key: 'key1',
  context: 'workspace',
}

function makeBody(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Weekly Report',
    content: 'Revenue: $100',
    model: 'claude-sonnet-5',
    workflowId: 'wf-1',
    ...overrides,
  }
}

function callRoute(body: unknown) {
  const url = 'http://localhost:3000/api/tools/artifact/generate'
  return POST(createMockRequest('POST', body, {}, url))
}

describe('POST /api/tools/artifact/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ success: true, userId: 'user-1', authType: 'session' })
    mockAuthorizeWorkflow.mockResolvedValue({
      allowed: true,
      status: 200,
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
      workspacePermission: 'write',
    })
    mockResolveBillingAttribution.mockResolvedValue({ billingEntity: 'ws-1' })
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: false })
    mockAssertPermissionsAllowed.mockResolvedValue(undefined)
    mockGetProviderFromModel.mockReturnValue('anthropic')
    mockExecuteProviderRequest.mockResolvedValue({
      content: VALID_HTML,
      cost: { total: 0.01 },
    })
    mockEnsureFolderPath.mockResolvedValue('folder-1')
    mockUploadWorkspaceFile.mockResolvedValue(UPLOADED_FILE)
    mockUpsertFileShare.mockResolvedValue({ token: 'tok', url: 'https://sim.ai/f/tok' })
  })

  it('returns 401 without auth', async () => {
    mockAuth.mockResolvedValue({ success: false })
    const response = await callRoute(makeBody())
    expect(response.status).toBe(401)
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  it('requires write access to the workflow', async () => {
    mockAuthorizeWorkflow.mockResolvedValue({
      allowed: false,
      status: 403,
      message: 'Access denied',
      workflow: null,
      workspacePermission: null,
    })
    const response = await callRoute(makeBody())
    expect(response.status).toBe(403)
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  it('rejects an invalid body', async () => {
    const response = await callRoute(makeBody({ title: '' }))
    expect(response.status).toBe(400)
  })

  it('blocks over-limit actors before calling the LLM', async () => {
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: true, message: 'over limit' })
    const response = await callRoute(makeBody())
    expect(response.status).toBe(402)
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  it('generates, uploads, and returns the artifact file', async () => {
    const response = await callRoute(makeBody())
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.output.file.id).toBe('wf_file1')
    expect(data.output.shareUrl).toBeNull()
    expect(mockEnsureFolderPath).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'user-1',
      pathSegments: ['Artifacts'],
    })
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      'ws-1',
      'user-1',
      expect.any(Buffer),
      'weekly-report.html',
      'text/html',
      { folderId: 'folder-1' }
    )
    expect(mockRecordUsage).toHaveBeenCalled()
  })

  it('strips markdown fences from the model output', async () => {
    mockExecuteProviderRequest.mockResolvedValue({
      content: '```html\n' + VALID_HTML + '\n```',
      cost: { total: 0 },
    })
    const response = await callRoute(makeBody())
    expect(response.status).toBe(200)
    const uploadedBuffer = mockUploadWorkspaceFile.mock.calls[0][2] as Buffer
    expect(uploadedBuffer.toString('utf-8')).toBe(VALID_HTML)
    expect(mockRecordUsage).not.toHaveBeenCalled()
  })

  it('rejects truncated output instead of saving a broken file', async () => {
    mockExecuteProviderRequest.mockResolvedValue({
      content: '<!DOCTYPE html><html><body>partial',
      cost: { total: 0 },
    })
    const response = await callRoute(makeBody())
    expect(response.status).toBe(502)
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
  })

  it('creates a public share link when requested', async () => {
    const response = await callRoute(makeBody({ createShareLink: true }))
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.output.shareUrl).toBe('https://sim.ai/f/tok')
    expect(mockValidatePublicFileSharing).toHaveBeenCalledWith('user-1', 'ws-1', 'public')
    expect(mockUpsertFileShare).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      fileId: 'wf_file1',
      userId: 'user-1',
      isActive: true,
      authType: 'public',
    })
  })
})
