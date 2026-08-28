/**
 * @vitest-environment node
 */
import type { DelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    loadContext: vi.fn(),
    resolvePermission: vi.fn(),
    getAvailableTool: vi.fn(),
    getByTitle: vi.fn(),
    getWorkspaceTool: vi.fn(),
    updateWorkspaceTool: vi.fn(),
    upsert: vi.fn(),
    audit: vi.fn(),
  },
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  loadActiveWorkspaceContext: mocks.loadContext,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) =>
    actual === 'admin' || actual === required || (actual === 'write' && required === 'read'),
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@sim/audit', () => ({
  AuditAction: {
    CUSTOM_TOOL_CREATED: 'custom_tool.created',
    CUSTOM_TOOL_UPDATED: 'custom_tool.updated',
    CUSTOM_TOOL_DELETED: 'custom_tool.deleted',
  },
  AuditResourceType: { CUSTOM_TOOL: 'custom_tool' },
  recordAudit: mocks.audit,
}))
vi.mock('@/lib/workflows/custom-tools/operations', () => ({
  deleteCustomTool: vi.fn(),
  deleteWorkspaceCustomTool: vi.fn(),
  getAvailableCustomTool: mocks.getAvailableTool,
  getCustomToolById: vi.fn(),
  getWorkspaceCustomTool: mocks.getWorkspaceTool,
  getWorkspaceCustomToolByTitle: mocks.getByTitle,
  listCustomTools: vi.fn(),
  listWorkspaceCustomTools: vi.fn(),
  updateCustomTool: vi.fn(),
  updateWorkspaceCustomTool: mocks.updateWorkspaceTool,
  upsertCustomTools: mocks.upsert,
}))

import { CUSTOM_TOOL_DELEGATION_AUDIENCE } from '@/lib/custom-tools/application/authorization'
import { customToolOperations } from '@/lib/custom-tools/application/operations'
import {
  createWorkspaceCustomToolUseCase,
  readAvailableCustomToolByIdOrTitleUseCase,
  saveWorkspaceCustomToolUseCase,
  updateWorkspaceCustomToolUseCase,
} from '@/lib/custom-tools/application/use-cases'

const workspace = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'owner-1',
}
const tool = {
  id: 'tool-1',
  workspaceId: workspace.workspaceId,
  userId: 'owner-1',
  title: 'lookup_order',
  schema: { type: 'function' },
  code: 'return 1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

describe('custom tool application use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadContext.mockResolvedValue(workspace)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.getByTitle.mockResolvedValue(null)
    mocks.getAvailableTool.mockResolvedValue(tool)
    mocks.upsert.mockResolvedValue([tool])
  })

  describe('delegated custom-tool resolution', () => {
    function executorPrincipal(overrides: Partial<DelegatedPrincipal> = {}): DelegatedPrincipal {
      return {
        kind: 'delegated' as const,
        serviceId: 'executor' as const,
        subjectUserId: 'user-1',
        workspaceId: workspace.workspaceId,
        delegationId: 'execution-1',
        audience: CUSTOM_TOOL_DELEGATION_AUDIENCE,
        issuedAt: new Date(Date.now() - 1_000),
        expiresAt: new Date(Date.now() + 60_000),
        ...overrides,
      }
    }

    it('declares the executor and Copilot read policy explicitly', () => {
      expect(customToolOperations.readAvailableByIdOrTitle).toMatchObject({
        id: 'custom_tools.read_available_by_id_or_title',
        minimumRole: 'read',
        workspaceApiKey: 'deny',
        principalKinds: ['delegated'],
        delegatedServices: ['copilot', 'executor'],
      })
    })

    it('authorizes the current subject and preserves workspace-first personal fallback lookup', async () => {
      mocks.resolvePermission.mockResolvedValueOnce('read')

      const result = await readAvailableCustomToolByIdOrTitleUseCase.execute({
        principal: executorPrincipal(),
        input: {
          workspaceId: workspace.workspaceId,
          identifier: tool.id,
          lookup: 'id_or_title',
        },
      })

      expect(result).toEqual({ tool })
      expect(mocks.getAvailableTool).toHaveBeenCalledWith({
        identifier: tool.id,
        userId: 'user-1',
        workspaceId: workspace.workspaceId,
        lookup: 'id_or_title',
      })
      expect(mocks.audit).not.toHaveBeenCalled()
    })

    it('preserves the legacy execution actor for an actorless deployment', async () => {
      const result = await readAvailableCustomToolByIdOrTitleUseCase.execute({
        principal: executorPrincipal({
          subjectUserId: undefined,
          delegationContext: {
            kind: 'workflow_execution',
            workflowId: 'workflow-1',
            executionId: 'execution-1',
            principal: {
              kind: 'system',
              serviceId: 'schedule',
              workspaceId: workspace.workspaceId,
              workflowId: 'workflow-1',
            },
            currentWorkflow: {
              workflowId: 'workflow-1',
              mode: 'deployment',
              deploymentVersionId: 'version-1',
            },
          },
        }),
        input: {
          workspaceId: workspace.workspaceId,
          identifier: tool.id,
          lookup: 'id_or_title',
          executionActorUserId: 'execution-actor',
        },
      })

      expect(result).toEqual({ tool })
      expect(mocks.resolvePermission).not.toHaveBeenCalled()
      expect(mocks.getAvailableTool).toHaveBeenCalledWith({
        identifier: tool.id,
        userId: 'execution-actor',
        workspaceId: workspace.workspaceId,
        lookup: 'id_or_title',
      })
    })

    it('refuses actorless lookup when the legacy execution actor is missing', async () => {
      await expect(
        readAvailableCustomToolByIdOrTitleUseCase.execute({
          principal: executorPrincipal({
            subjectUserId: undefined,
            delegationContext: {
              kind: 'workflow_execution',
              workflowId: 'workflow-1',
              currentWorkflow: {
                workflowId: 'workflow-1',
                mode: 'deployment',
                deploymentVersionId: 'version-1',
              },
            },
          }),
          input: {
            workspaceId: workspace.workspaceId,
            identifier: tool.id,
            lookup: 'id',
          },
        })
      ).rejects.toMatchObject({
        code: 'forbidden',
        message:
          'Custom tools are resolved from a user library, and this run has no execution actor',
      })
      expect(mocks.getAvailableTool).not.toHaveBeenCalled()
    })

    it('conceals a workspace assertion outside the delegated workspace before lookup', async () => {
      mocks.loadContext.mockResolvedValueOnce({ ...workspace, workspaceId: 'workspace-2' })

      await expect(
        readAvailableCustomToolByIdOrTitleUseCase.execute({
          principal: executorPrincipal(),
          input: {
            workspaceId: 'workspace-2',
            identifier: tool.id,
            lookup: 'id',
          },
        })
      ).rejects.toMatchObject({ code: 'forbidden' })

      expect(mocks.resolvePermission).not.toHaveBeenCalled()
      expect(mocks.getAvailableTool).not.toHaveBeenCalled()
    })

    it('rejects the wrong delegation audience before lookup', async () => {
      await expect(
        readAvailableCustomToolByIdOrTitleUseCase.execute({
          principal: executorPrincipal({ audience: 'sim:other' }),
          input: {
            workspaceId: workspace.workspaceId,
            identifier: tool.id,
            lookup: 'id',
          },
        })
      ).rejects.toMatchObject({ code: 'forbidden' })

      expect(mocks.resolvePermission).not.toHaveBeenCalled()
      expect(mocks.getAvailableTool).not.toHaveBeenCalled()
    })

    it('re-checks the delegated subject current workspace access before lookup', async () => {
      mocks.resolvePermission.mockResolvedValueOnce(null)

      await expect(
        readAvailableCustomToolByIdOrTitleUseCase.execute({
          principal: executorPrincipal(),
          input: {
            workspaceId: workspace.workspaceId,
            identifier: tool.id,
            lookup: 'id',
          },
        })
      ).rejects.toMatchObject({ code: 'forbidden' })

      expect(mocks.resolvePermission).toHaveBeenCalledWith(
        'user-1',
        workspace.workspaceId,
        workspace.workspaceOrganizationId,
        undefined,
        { forUpdate: undefined }
      )
      expect(mocks.getAvailableTool).not.toHaveBeenCalled()
    })
  })

  it('uses compatibility attribution without impersonating a workspace-key audit actor', async () => {
    const principal = {
      kind: 'workspace_api_key' as const,
      workspaceId: workspace.workspaceId,
      keyId: 'workspace-key-1',
    }

    const result = await createWorkspaceCustomToolUseCase.execute({
      principal,
      input: {
        workspaceId: workspace.workspaceId,
        title: tool.title,
        schema: tool.schema,
        code: tool.code,
        source: 'api',
      },
    })

    expect(result.tool.id).toBe(tool.id)
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.upsert).toHaveBeenCalledWith({
      tools: [{ title: tool.title, schema: tool.schema, code: tool.code }],
      workspaceId: workspace.workspaceId,
      userId: workspace.billedAccountUserId,
    })
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        actorName: 'Workspace API key',
        metadata: expect.objectContaining({
          operation: 'custom_tools.create',
          actor: {
            kind: 'workspace_api_key',
            keyId: 'workspace-key-1',
            workspaceId: workspace.workspaceId,
          },
        }),
      })
    )
  })

  it('returns a typed conflict and does not audit a rejected create', async () => {
    mocks.getByTitle.mockResolvedValueOnce(tool)

    await expect(
      createWorkspaceCustomToolUseCase.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          workspaceId: workspace.workspaceId,
          title: tool.title,
          schema: tool.schema,
          code: tool.code,
        },
      })
    ).rejects.toMatchObject({ code: 'conflict' })

    expect(mocks.upsert).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('normalizes the in-transaction duplicate-title error for strict creates', async () => {
    mocks.upsert.mockRejectedValueOnce(
      new Error(`A tool with the title "${tool.title}" already exists in this workspace`)
    )

    await expect(
      createWorkspaceCustomToolUseCase.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          workspaceId: workspace.workspaceId,
          title: tool.title,
          schema: tool.schema,
          code: tool.code,
        },
      })
    ).rejects.toMatchObject({ code: 'conflict' })

    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('normalizes the in-transaction duplicate-title error for compatibility saves', async () => {
    mocks.upsert.mockRejectedValueOnce(
      new Error(`A tool with the title "${tool.title}" already exists in this workspace`)
    )

    await expect(
      saveWorkspaceCustomToolUseCase.execute({
        principal: {
          kind: 'delegated',
          serviceId: 'copilot',
          subjectUserId: 'user-1',
          workspaceId: workspace.workspaceId,
          delegationId: 'delegation-1',
          audience: CUSTOM_TOOL_DELEGATION_AUDIENCE,
          issuedAt: new Date(Date.now() - 1_000),
          expiresAt: new Date(Date.now() + 60_000),
        },
        input: {
          workspaceId: workspace.workspaceId,
          title: tool.title,
          schema: tool.schema,
          code: tool.code,
          source: 'tool_input',
        },
      })
    ).rejects.toMatchObject({ code: 'conflict' })

    expect(mocks.audit).not.toHaveBeenCalled()
  })

  describe('public update against the shape the response publishes', () => {
    const storableSchema = {
      type: 'function',
      function: {
        name: 'lookup_order',
        parameters: { type: 'object', properties: { id: { type: 'string' } } },
      },
    }
    const session = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }

    it('renames a tool whose stored schema can be published', async () => {
      const stored = { ...tool, schema: storableSchema }
      mocks.getWorkspaceTool.mockResolvedValueOnce(stored)
      mocks.updateWorkspaceTool.mockResolvedValueOnce({ ...stored, title: 'renamed' })

      const result = await updateWorkspaceCustomToolUseCase.execute({
        principal: session,
        input: { workspaceId: workspace.workspaceId, toolId: tool.id, title: 'renamed' },
      })

      expect(result.tool.title).toBe('renamed')
      expect(mocks.updateWorkspaceTool).toHaveBeenCalledWith(
        expect.objectContaining({ schema: storableSchema, code: tool.code })
      )
    })

    it('refuses before committing when the stored schema cannot be published', async () => {
      mocks.getWorkspaceTool.mockResolvedValueOnce({
        ...tool,
        schema: { function: storableSchema.function },
      })

      await expect(
        updateWorkspaceCustomToolUseCase.execute({
          principal: session,
          input: { workspaceId: workspace.workspaceId, toolId: tool.id, title: 'renamed' },
        })
      ).rejects.toMatchObject({ code: 'validation' })

      expect(mocks.updateWorkspaceTool).not.toHaveBeenCalled()
      expect(mocks.audit).not.toHaveBeenCalled()
    })

    it('refuses a supplied schema that cannot be published', async () => {
      mocks.getWorkspaceTool.mockResolvedValueOnce({ ...tool, schema: storableSchema })

      await expect(
        updateWorkspaceCustomToolUseCase.execute({
          principal: session,
          input: {
            workspaceId: workspace.workspaceId,
            toolId: tool.id,
            schema: { ...storableSchema, type: 'object' },
          },
        })
      ).rejects.toMatchObject({ code: 'validation' })

      expect(mocks.updateWorkspaceTool).not.toHaveBeenCalled()
      expect(mocks.audit).not.toHaveBeenCalled()
    })
  })
})
