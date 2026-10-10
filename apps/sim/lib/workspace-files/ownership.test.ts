import { describe, expect, it } from 'vitest'
import { resolveFileOwner } from '@/lib/workspace-files/ownership'

const legacyWorkspaceFile = {
  projectId: null,
  context: 'workspace',
  workspaceId: 'workspace-a',
  organizationId: null,
  userId: 'uploader-a',
  chatId: null,
  folderId: null,
}

const projectFile = {
  ...legacyWorkspaceFile,
  projectId: 'project-a',
  context: 'project',
  workspaceId: null,
}

describe('file ownership isolation', () => {
  it.each(['workspace', 'chat'])(
    'preserves the explicit workspace owner of a legacy %s file',
    (context) => {
      expect(resolveFileOwner({ ...legacyWorkspaceFile, context })).toEqual({
        entityType: 'workspace',
        entityId: 'workspace-a',
      })
    }
  )

  it('does not change shared ownership when the uploader changes', () => {
    expect(
      resolveFileOwner({
        ...legacyWorkspaceFile,
        userId: 'different-uploader',
      })
    ).toEqual({ entityType: 'workspace', entityId: 'workspace-a' })
    expect(resolveFileOwner({ ...projectFile, userId: 'different-uploader' })).toEqual({
      entityType: 'project',
      entityId: 'project-a',
    })
  })

  it('rejects ambiguous legacy ownership instead of picking the first scope', () => {
    expect(
      resolveFileOwner({ ...legacyWorkspaceFile, organizationId: 'organization-a' })
    ).toBeNull()
    expect(resolveFileOwner({ ...legacyWorkspaceFile, workspaceId: '' })).toBeNull()
  })

  it.each(['chat', 'general', 'logs', 'table-import', 'og-images', 'unrecognized'])(
    'does not treat an uploader as the owner of an unclassified %s file',
    (context) => {
      const file = { ...legacyWorkspaceFile, context, workspaceId: null }
      expect(resolveFileOwner(file)).toBeNull()
    }
  )

  it.each([
    { projectId: null },
    { projectId: '' },
    { workspaceId: 'workspace-a' },
    { organizationId: 'organization-a' },
    { chatId: 'chat-a' },
    { context: 'workspace' },
  ])('rejects Project ownership mixed with legacy associations %j', (binding) => {
    expect(resolveFileOwner({ ...projectFile, ...binding })).toBeNull()
  })

  it('preserves organization KB ownership independently of the uploader', () => {
    const file = {
      ...legacyWorkspaceFile,
      context: 'knowledge-base',
      workspaceId: null,
      organizationId: 'organization-a',
    }
    expect(resolveFileOwner(file)).toEqual({
      entityType: 'organization',
      entityId: 'organization-a',
    })
  })

  it.each(['copilot', 'profile-pictures'])(
    'binds audited personal %s files to their existing personal owner',
    (context) => {
      const file = { ...legacyWorkspaceFile, context, workspaceId: null }
      expect(resolveFileOwner(file)).toEqual({ entityType: 'user', entityId: 'uploader-a' })
      expect(resolveFileOwner({ ...file, userId: null })).toBeNull()
    }
  )
})
