import { createHash } from 'node:crypto'
import { db } from '@sim/db'
import {
  appProject,
  appRevisionAction,
  appSourceBlob,
  appSourceFile,
  appSourceRevision,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import type { AppActionManifestEntry } from '@/lib/apps/manifest'
import {
  APP_LOCKFILE_HASH_PLACEHOLDER,
  APP_SDK_VERSION,
  APP_TEMPLATE_FILES,
  APP_TEMPLATE_VERSION,
} from '@/lib/apps/template/versions'

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function hashTree(files: Record<string, string>): string {
  const entries = Object.keys(files)
    .sort()
    .map((path) => `${path}:${hashContent(files[path])}`)
  return hashContent(entries.join('\n'))
}

function hashManifest(actions: AppActionManifestEntry[]): string {
  return hashContent(JSON.stringify(actions))
}

export async function createRevisionWithActions(params: {
  projectId: string
  userId: string
  actions: AppActionManifestEntry[]
  files?: Record<string, string>
  parentRevisionId?: string | null
}): Promise<{ revisionId: string }> {
  const files = params.files ?? { ...APP_TEMPLATE_FILES }
  const sourceTreeHash = hashTree(files)
  const actionManifestHash = hashManifest(params.actions)
  const revisionId = generateId()

  await db.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(appProject)
      .where(and(eq(appProject.id, params.projectId), isNull(appProject.archivedAt)))
      .for('update')
      .limit(1)

    if (!project) {
      throw new Error('Project not found')
    }

    await tx.insert(appSourceRevision).values({
      id: revisionId,
      projectId: params.projectId,
      parentRevisionId: params.parentRevisionId ?? project.draftRevisionId ?? null,
      sourceTreeHash,
      actionManifestHash,
      templateVersion: APP_TEMPLATE_VERSION,
      sdkVersion: APP_SDK_VERSION,
      lockfileHash: APP_LOCKFILE_HASH_PLACEHOLDER,
      createdBy: params.userId,
    })

    for (const [path, content] of Object.entries(files)) {
      const contentHash = hashContent(content)
      await tx
        .insert(appSourceBlob)
        .values({ hash: contentHash, content, byteSize: Buffer.byteLength(content, 'utf8') })
        .onConflictDoNothing()

      await tx.insert(appSourceFile).values({
        id: generateId(),
        revisionId,
        path,
        contentHash,
      })
    }

    for (const action of params.actions) {
      await tx.insert(appRevisionAction).values({
        id: generateId(),
        revisionId,
        actionId: action.actionId,
        workflowId: action.workflowId,
        deploymentVersionId: action.deploymentVersionId,
        inputSchema: action.inputSchema,
        outputAllowlist: action.outputAllowlist,
        executionPolicy: action.executionPolicy,
        schemaHash: action.schemaHash,
      })
    }

    await tx
      .update(appProject)
      .set({ draftRevisionId: revisionId, updatedAt: new Date() })
      .where(eq(appProject.id, params.projectId))
  })

  return { revisionId }
}
