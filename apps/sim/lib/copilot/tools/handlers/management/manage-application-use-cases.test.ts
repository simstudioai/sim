/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks, useCases } = vi.hoisted(() => ({
  mocks: {
    custom: vi.fn(),
    mcp: vi.fn(),
    skill: vi.fn(),
    credential: vi.fn(),
    capture: vi.fn(),
  },
  useCases: {
    saveCustom: { operation: { id: 'custom_tools.save' } },
    deleteCustom: { operation: { id: 'custom_tools.delete_available' } },
    listCustom: { operation: { id: 'custom_tools.list_available' } },
    updateCustom: { operation: { id: 'custom_tools.update_available' } },
    deleteMcp: { operation: { id: 'mcp_servers.delete' } },
    listMcp: { operation: { id: 'mcp_servers.list' } },
    reconfigureMcp: { operation: { id: 'mcp_servers.reconfigure' } },
    registerMcp: { operation: { id: 'mcp_servers.register' } },
    createSkill: { operation: { id: 'skills.create' } },
    deleteSkill: { operation: { id: 'skills.delete' } },
    listSkill: { operation: { id: 'skills.list_available' } },
    updateSkill: { operation: { id: 'skills.update' } },
    updateCredential: { operation: { id: 'credentials.update' } },
    deleteManyCredentials: { operation: { id: 'credentials.delete_many' } },
  },
}))

vi.mock('@/lib/copilot/application/execute-custom-tool-use-case', () => ({
  executeCopilotCustomToolUseCase: mocks.custom,
}))
vi.mock('@/lib/copilot/application/execute-mcp-server-use-case', () => ({
  executeCopilotMcpServerUseCase: mocks.mcp,
}))
vi.mock('@/lib/copilot/application/execute-skill-use-case', () => ({
  executeCopilotSkillUseCase: mocks.skill,
}))
vi.mock('@/lib/copilot/application/execute-credential-use-case', () => ({
  executeCopilotCredentialUseCase: mocks.credential,
}))
vi.mock('@/lib/custom-tools/application/use-cases', () => ({
  deleteAvailableCustomToolUseCase: useCases.deleteCustom,
  listAvailableCustomToolsUseCase: useCases.listCustom,
  saveWorkspaceCustomToolUseCase: useCases.saveCustom,
  updateAvailableCustomToolUseCase: useCases.updateCustom,
}))
vi.mock('@/lib/mcp/application/use-cases', () => ({
  deleteMcpServerUseCase: useCases.deleteMcp,
  listMcpServersUseCase: useCases.listMcp,
  reconfigureMcpServerUseCase: useCases.reconfigureMcp,
  registerMcpServerUseCase: useCases.registerMcp,
}))
vi.mock('@/lib/skills/application/use-cases', () => ({
  createSkillUseCase: useCases.createSkill,
  deleteSkillUseCase: useCases.deleteSkill,
  listAvailableSkillsUseCase: useCases.listSkill,
  updateSkillUseCase: useCases.updateSkill,
}))
vi.mock('@/lib/credentials/application/credential-crud', () => ({
  updateWorkspaceCredentialUseCase: useCases.updateCredential,
}))
vi.mock('@/lib/credentials/application/delete-many-credentials', () => ({
  deleteManyCredentialsUseCase: useCases.deleteManyCredentials,
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.capture }))

import type { ExecutionContext } from '@/lib/copilot/request/types'
import { executeManageCredential } from '@/lib/copilot/tools/handlers/management/manage-credential'
import { executeManageCustomTool } from '@/lib/copilot/tools/handlers/management/manage-custom-tool'
import { executeManageMcpTool } from '@/lib/copilot/tools/handlers/management/manage-mcp-tool'
import { executeManageSkill } from '@/lib/copilot/tools/handlers/management/manage-skill'

const context: ExecutionContext = {
  userId: 'user-1',
  workflowId: '',
  workspaceId: 'workspace-1',
  chatId: 'chat-1',
  toolCallId: 'call-1',
  copilotToolExecution: true,
  userPermission: 'admin',
}

describe('Copilot management application boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates custom tools through the shared use case using server workspace context', async () => {
    mocks.custom.mockResolvedValue({
      tool: { id: 'tool-1', title: 'lookup_order' },
    })

    const result = await executeManageCustomTool(
      {
        operation: 'add',
        workspaceId: 'model-workspace',
        title: 'lookup_order',
        schema: {
          type: 'function',
          function: { name: 'lookup_order', parameters: {} },
        },
        code: 'return 1',
      },
      context
    )

    expect(result).toMatchObject({ success: true, output: { toolId: 'tool-1' } })
    expect(mocks.custom).toHaveBeenCalledWith(context, useCases.saveCustom, {
      workspaceId: context.workspaceId,
      title: 'lookup_order',
      schema: {
        type: 'function',
        function: { name: 'lookup_order', parameters: {} },
      },
      code: 'return 1',
      source: 'tool_input',
    })
  })

  it('keeps Copilot MCP registration compatibility behind its semantic operation', async () => {
    mocks.mcp.mockResolvedValue({
      serverId: 'legacy-result-id',
      server: {
        id: 'mcp-server-1',
        name: 'Docs',
        transport: 'streamable-http',
      },
      updated: true,
    })

    const result = await executeManageMcpTool(
      {
        operation: 'add',
        config: { name: 'Docs', url: 'https://mcp.example.com/sse' },
      },
      context
    )

    expect(result).toMatchObject({ success: true, output: { serverId: 'mcp-server-1' } })
    expect(mocks.mcp).toHaveBeenCalledWith(
      context,
      useCases.registerMcp,
      expect.objectContaining({ workspaceId: context.workspaceId, source: 'tool_input' })
    )
    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it('delegates skill-specific edit authorization to the shared application use case', async () => {
    mocks.skill.mockResolvedValue({
      skill: { id: 'skill-1', name: 'refund-policy' },
    })

    const result = await executeManageSkill(
      { operation: 'edit', skillId: 'skill-1', content: '# Updated' },
      { ...context, userPermission: 'read' }
    )

    expect(result).toMatchObject({ success: true, output: { skillId: 'skill-1' } })
    expect(mocks.skill).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: context.workspaceId }),
      useCases.updateSkill,
      {
        workspaceId: context.workspaceId,
        skillId: 'skill-1',
        content: '# Updated',
        source: 'tool_input',
      }
    )
  })

  it('renames credentials through the shared credential use case', async () => {
    mocks.credential.mockResolvedValue({
      credential: { id: 'credential-1', displayName: 'Renamed' },
      previousDisplayName: 'Original',
    })

    const result = await executeManageCredential(
      { operation: 'rename', credentialId: 'credential-1', displayName: 'Renamed' },
      context
    )

    expect(result).toMatchObject({
      success: true,
      output: { previousDisplayName: 'Original', displayName: 'Renamed' },
    })
    expect(mocks.credential).toHaveBeenCalledWith(context, useCases.updateCredential, {
      credentialId: 'credential-1',
      displayName: 'Renamed',
    })
  })

  it('keeps best-effort batch deletion inside one semantic application command', async () => {
    mocks.credential.mockResolvedValue({ deleted: ['credential-1'], failed: ['credential-2'] })

    const result = await executeManageCredential(
      { operation: 'delete', credentialIds: ['credential-1', 'credential-2'] },
      context
    )

    expect(result).toMatchObject({
      success: true,
      output: { deleted: ['credential-1'], failed: ['credential-2'] },
    })
    expect(mocks.credential).toHaveBeenCalledWith(context, useCases.deleteManyCredentials, {
      workspaceId: 'workspace-1',
      credentialIds: ['credential-1', 'credential-2'],
    })
  })
})
