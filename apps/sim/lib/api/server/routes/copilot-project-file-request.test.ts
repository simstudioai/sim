import { describe, expect, it } from 'vitest'
import {
  copilotRequestPrincipal,
  isCopilotRequest,
  markCopilotProjectFileRequest,
} from '@/lib/api/server/routes/copilot-request'
import { requireResourceDelegation } from '@/lib/core/application/resource-delegation'
import {
  type CopilotExecutionContext,
  createCopilotResourceAdmission,
} from '@/lib/mothership/auth/application-delegation'
import { getProjectFileMetadata, listProjectFiles } from '@/lib/projects/files/application'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
import { listAllWorkspaceFiles } from '@/lib/workspace-files/application/list-workspace-files'

function authoringContext(): CopilotExecutionContext {
  return {
    userId: 'actor',
    chatId: 'private-chat',
    toolCallId: 'tool-call',
    copilotToolExecution: true,
    copilotResourceAdmission: createCopilotResourceAdmission({
      userId: 'actor',
      invocation: { kind: 'chat', chatId: 'private-chat' },
    }),
  }
}

function request() {
  return new Request('https://sim.test/api/v2/projects/project/files/file/metadata', {
    headers: {
      'x-mothership-project-id': 'project',
      'x-mothership-user-id': 'actor',
      'x-api-key': 'mothership-in-process',
    },
  })
}

describe('private v2 Project file authority', () => {
  it('retains the admitted human and exact target without a workspace delegation', () => {
    const req = request()
    const context = authoringContext()
    const target = { projectId: 'project', fileId: 'file' }
    markCopilotProjectFileRequest(req, context, target)
    context.userId = 'later-user'
    target.projectId = 'later-project'
    const principal = copilotRequestPrincipal(
      req,
      projectFileOperations.readMetadata,
      getProjectFileMetadata
    )
    if (!principal) throw new Error('The admitted Project file request lost its principal')
    expect(principal).toMatchObject({
      kind: 'resource_delegated',
      subjectUserId: 'actor',
      invocation: { kind: 'chat', chatId: 'private-chat' },
      scope: { kind: 'entity', entityType: 'project', entityId: 'project', fileId: 'file' },
    })
    expect(principal).not.toHaveProperty('workspaceId')
    expect(
      requireResourceDelegation(principal, {
        audience: 'sim:project-files',
        services: ['copilot'],
        scope: { kind: 'entity', entityType: 'project', entityId: 'project', fileId: 'file' },
        maxTtlMs: 60_000,
      })
    ).toBe('actor')
  })

  it('does not transfer private admission through headers or a cloned Request', () => {
    const req = request()
    expect(isCopilotRequest(req)).toBe(false)
    expect(
      copilotRequestPrincipal(req, projectFileOperations.readMetadata, getProjectFileMetadata)
    ).toBeUndefined()
    markCopilotProjectFileRequest(req, authoringContext(), { projectId: 'project', fileId: 'file' })
    const cloned = new Request(req)
    expect(isCopilotRequest(cloned)).toBe(false)
    expect(
      copilotRequestPrincipal(cloned, projectFileOperations.readMetadata, getProjectFileMetadata)
    ).toBeUndefined()
  })

  it.each([
    ['missing evidence', { copilotResourceAdmission: undefined }],
    ['changed subject', { userId: 'another-user' }],
    ['changed chat', { chatId: 'another-chat' }],
    ['workflow execution', { boundWorkflowExecutionId: 'workflow-run' }],
    ['executor origin', { executorDelegationOrigin: {} }],
    ['Mothership block', { mcpBlockId: 'block' }],
  ] as const)('rejects %s before marking the request', (_name, changes) => {
    const req = request()
    expect(() =>
      markCopilotProjectFileRequest(
        req,
        { ...authoringContext(), ...changes },
        { projectId: 'project' }
      )
    ).toThrow('Copilot resource operations require current authoring admission')
    expect(isCopilotRequest(req)).toBe(false)
  })

  it('rejects a serialized admission even when its actor and target fields match', () => {
    const context = authoringContext()
    context.copilotResourceAdmission = structuredClone(context.copilotResourceAdmission)
    expect(() =>
      markCopilotProjectFileRequest(request(), context, { projectId: 'project' })
    ).toThrow('Copilot resource operations require current authoring admission')
  })

  it('never changes a file-bound request into collection or workspace authority', () => {
    const req = request()
    markCopilotProjectFileRequest(req, authoringContext(), { projectId: 'project', fileId: 'file' })
    expect(
      copilotRequestPrincipal(req, projectFileOperations.list, listProjectFiles)
    ).toBeUndefined()
    expect(
      copilotRequestPrincipal(req, listAllWorkspaceFiles.operation, listAllWorkspaceFiles)
    ).toBeUndefined()
    const collection = request()
    markCopilotProjectFileRequest(collection, authoringContext(), { projectId: 'project' })
    expect(
      copilotRequestPrincipal(collection, projectFileOperations.list, listProjectFiles)
    ).toMatchObject({
      scope: { kind: 'entity', entityType: 'project', entityId: 'project' },
    })
    expect(
      copilotRequestPrincipal(
        collection,
        projectFileOperations.readMetadata,
        getProjectFileMetadata
      )
    ).toBeUndefined()
  })

  it('rejects unregistered operation identities and mismatched use-case policies', () => {
    const req = request()
    markCopilotProjectFileRequest(req, authoringContext(), { projectId: 'project', fileId: 'file' })
    const clone = { ...projectFileOperations.readMetadata }
    expect(
      copilotRequestPrincipal(req, clone, { ...getProjectFileMetadata, operation: clone })
    ).toBeUndefined()
    expect(
      copilotRequestPrincipal(req, projectFileOperations.readMetadata, listProjectFiles)
    ).toBeUndefined()
    expect(
      copilotRequestPrincipal(req, projectFileOperations.readMetadata, {
        ...getProjectFileMetadata,
        delegationAudience: 'sim:other',
      })
    ).toBeUndefined()
    expect(copilotRequestPrincipal(req, projectFileOperations.readMetadata)).toBeUndefined()
  })
})
