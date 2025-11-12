import { db } from '@sim/db'
import { permissions, workflow, workflowFolder, workspace as workspaceTable } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { duplicateWorkflow } from '@/lib/workflows/duplicate'

const logger = createLogger('WorkspaceDuplicate')

interface DuplicateWorkspaceOptions {
  sourceWorkspaceId: string
  userId: string
  name: string
  requestId?: string
}

interface DuplicateWorkspaceResult {
  id: string
  name: string
  ownerId: string
  workflowsCount: number
  foldersCount: number
}

/**
 * Duplicate a workspace with all its workflows
 * This creates a new workspace and duplicates all workflows from the source workspace
 */
export async function duplicateWorkspace(
  options: DuplicateWorkspaceOptions
): Promise<DuplicateWorkspaceResult> {
  const { sourceWorkspaceId, userId, name, requestId = 'unknown' } = options

  // Generate new workspace ID
  const newWorkspaceId = crypto.randomUUID()
  const now = new Date()

  // Verify the source workspace exists and user has permission
  const sourceWorkspace = await db
    .select()
    .from(workspaceTable)
    .where(eq(workspaceTable.id, sourceWorkspaceId))
    .limit(1)
    .then((rows) => rows[0])

  if (!sourceWorkspace) {
    throw new Error('Source workspace not found')
  }

  // Check if user has permission to access the source workspace
  const userPermission = await getUserEntityPermissions(userId, 'workspace', sourceWorkspaceId)
  if (!userPermission) {
    throw new Error('Source workspace not found or access denied')
  }

  // Create new workspace with admin permission in a transaction
  await db.transaction(async (tx) => {
    // Create the new workspace
    await tx.insert(workspaceTable).values({
      id: newWorkspaceId,
      name,
      ownerId: userId,
      billedAccountUserId: userId,
      allowPersonalApiKeys: sourceWorkspace.allowPersonalApiKeys,
      createdAt: now,
      updatedAt: now,
    })

    // Grant admin permission to the user on the new workspace
    await tx.insert(permissions).values({
      id: crypto.randomUUID(),
      userId,
      entityType: 'workspace',
      entityId: newWorkspaceId,
      permissionType: 'admin',
      createdAt: now,
      updatedAt: now,
    })
  })

  // Get all folders from the source workspace
  const sourceFolders = await db
    .select()
    .from(workflowFolder)
    .where(eq(workflowFolder.workspaceId, sourceWorkspaceId))

  // Create folder ID mapping
  const folderIdMap = new Map<string, string>()

  // Duplicate folders (need to maintain hierarchy)
  const foldersByParent = new Map<string | null, typeof sourceFolders>()
  for (const folder of sourceFolders) {
    const parentKey = folder.parentId
    if (!foldersByParent.has(parentKey)) {
      foldersByParent.set(parentKey, [])
    }
    foldersByParent.get(parentKey)!.push(folder)
  }

  // Recursive function to duplicate folders in correct order
  const duplicateFolderHierarchy = async (parentId: string | null) => {
    const foldersAtLevel = foldersByParent.get(parentId) || []

    for (const sourceFolder of foldersAtLevel) {
      const newFolderId = crypto.randomUUID()
      folderIdMap.set(sourceFolder.id, newFolderId)

      await db.insert(workflowFolder).values({
        id: newFolderId,
        userId,
        workspaceId: newWorkspaceId,
        name: sourceFolder.name,
        color: sourceFolder.color,
        parentId: parentId ? folderIdMap.get(parentId) || null : null,
        sortOrder: sourceFolder.sortOrder,
        isExpanded: false,
        createdAt: now,
        updatedAt: now,
      })

      // Recursively duplicate child folders
      await duplicateFolderHierarchy(sourceFolder.id)
    }
  }

  // Start duplication from root level (parentId = null)
  await duplicateFolderHierarchy(null)

  // Get all workflows from the source workspace
  const sourceWorkflows = await db
    .select()
    .from(workflow)
    .where(eq(workflow.workspaceId, sourceWorkspaceId))

  // Duplicate each workflow with mapped folder IDs
  let workflowsCount = 0
  for (const sourceWorkflow of sourceWorkflows) {
    try {
      const newFolderId = sourceWorkflow.folderId
        ? folderIdMap.get(sourceWorkflow.folderId) || null
        : null

      await duplicateWorkflow({
        sourceWorkflowId: sourceWorkflow.id,
        userId,
        name: sourceWorkflow.name,
        description: sourceWorkflow.description || undefined,
        color: sourceWorkflow.color || undefined,
        workspaceId: newWorkspaceId,
        folderId: newFolderId,
        requestId,
      })
      workflowsCount++
    } catch (error) {
      logger.error(`Failed to duplicate workflow ${sourceWorkflow.id}:`, error)
      // Continue with other workflows even if one fails
    }
  }

  return {
    id: newWorkspaceId,
    name,
    ownerId: userId,
    workflowsCount,
    foldersCount: folderIdMap.size,
  }
}
