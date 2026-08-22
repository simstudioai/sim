import { describe, expect, it } from 'vitest'
import { formatV2AuditLogEntry } from '@/app/api/v2/audit-logs/format'

describe('formatV2AuditLogEntry', () => {
  it('removes internal folder identifiers recursively from the public projection', () => {
    const formatted = formatV2AuditLogEntry({
      id: 'audit-1',
      workspaceId: 'workspace-1',
      actorName: 'Teddy',
      actorEmail: 'teddy@example.com',
      action: 'folder.moved',
      resourceType: 'folder',
      resourceId: 'internal-folder-id',
      resourceName: 'Reports',
      description: 'Moved Reports',
      metadata: {
        folderId: 'internal-folder-id',
        targetFolderId: 'internal-target-id',
        nested: { tableImportFolderId: 'internal-import-id', path: '/Reports' },
      },
      createdAt: new Date('2024-01-01T00:00:00Z'),
    })

    expect(formatted.resourceId).toBeNull()
    expect(formatted).not.toHaveProperty('actorId')
    expect(formatted.actorEmail).toBe('teddy@example.com')
    expect(formatted.metadata).toEqual({ nested: { path: '/Reports' } })
  })
})
