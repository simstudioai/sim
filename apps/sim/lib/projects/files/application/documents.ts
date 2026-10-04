import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import * as Y from 'yjs'
import {
  assertCollabDocStateSize,
  CollabDocStateConflictError,
  hashMarkdown,
  loadCollabDocState,
  type PreparedCollabDocState,
  saveCollabDocStateInTx,
} from '@/lib/collab-doc/collab-state'
import { yDocToFileMarkdown } from '@/lib/collab-doc/converter'
import { type PersistFileDocResult, preparePersistedState } from '@/lib/collab-doc/persist'
import { type FileDocSeed, prepareFileDocSeed } from '@/lib/collab-doc/seed'
import type { AuthorizingUseCase } from '@/lib/core/application/authorized-workspace-use-case'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  createProjectFileAuthorizer,
  type ProjectFileAuthorizationContext,
} from '@/lib/projects/files/application/authorization'
import { defineAuthorizedProjectFileUseCase } from '@/lib/projects/files/application/authorized-use-case'
import {
  readProjectFileContent,
  updateProjectFileContent,
} from '@/lib/projects/files/application/content'
import { readProjectFileDocIdInTx } from '@/lib/projects/files/application/document-lifecycle'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
import { isMarkdownFile } from '@/lib/uploads/utils/file-utils'

interface ProjectDocumentTarget {
  projectId: string
  fileId: string
}

interface ProjectDocumentCacheInput extends ProjectDocumentTarget {
  expectedVersion: number
  state: PreparedCollabDocState
}

interface ProjectDocumentPersistInput extends ProjectDocumentTarget {
  docState: Uint8Array
  expectedVersion?: number
}

const MAX_SEED_BYTES = 5 * 1024 * 1024
const MAX_ATTEMPTS = 3

function requireProjectDocument(context: ProjectFileAuthorizationContext) {
  if (!context.file) throw new OrchestrationError('not_found', 'File not found')
  if (!isMarkdownFile({ name: context.file.originalName, type: context.file.contentType })) {
    throw new OrchestrationError('validation', 'Collaborative documents must be Markdown files')
  }
}

/** Current read membership and the separate write capability for a Project document subscriber. */
export const getProjectFileDocAccess = defineAuthorizedProjectFileUseCase<
  typeof projectFileOperations.readContent,
  ProjectDocumentTarget,
  ProjectDocumentTarget & { canRead: true; canWrite: boolean; docId: string | null }
>({
  operation: projectFileOperations.readContent,
  async execute({ context, input, tx }) {
    requireProjectDocument(context)
    return {
      ...input,
      canRead: true as const,
      canWrite: context.canWrite,
      docId: await readProjectFileDocIdInTx(tx, input.fileId),
    }
  },
})

function cacheUseCase(
  operation: typeof projectFileOperations.readContent | typeof projectFileOperations.updateContent
) {
  return defineAuthorizedProjectFileUseCase<
    typeof operation,
    ProjectDocumentCacheInput,
    { version: number }
  >({
    operation,
    async execute({ input, tx, context }) {
      requireProjectDocument(context)
      const [file] = await tx
        .select({ version: workspaceFiles.contentUpdatedAt })
        .from(workspaceFiles)
        .where(
          and(
            eq(workspaceFiles.id, input.fileId),
            eq(workspaceFiles.entityType, 'project'),
            eq(workspaceFiles.entityId, input.projectId),
            eq(workspaceFiles.context, 'project'),
            isNull(workspaceFiles.deletedAt)
          )
        )
        .for('share')
        .limit(1)
      if (!file) throw new OrchestrationError('not_found', 'File not found')
      if (file.version.getTime() !== input.expectedVersion)
        throw new OrchestrationError('conflict', 'File changed while preparing its document')
      await saveCollabDocStateInTx(tx, input.fileId, input.state)
      return { version: file.version.getTime() }
    },
  })
}

const seedCache = cacheUseCase(projectFileOperations.readContent)
const persistCache = cacheUseCase(projectFileOperations.updateContent)

function isDocumentConflict(error: unknown) {
  return (
    error instanceof CollabDocStateConflictError ||
    (error instanceof OrchestrationError && error.code === 'conflict')
  )
}

/** The seed cache is a read projection, fenced against both durable bytes and cached CRDT history. */
export const buildProjectFileDocSeed: AuthorizingUseCase<
  typeof projectFileOperations.readContent,
  ProjectDocumentTarget,
  FileDocSeed
> = {
  operation: projectFileOperations.readContent,
  delegationAudience: projectFileOperations.readContent.delegationAudience,
  authorize: async (args) => {
    await getProjectFileDocAccess.execute(args)
  },
  async execute(args) {
    await getProjectFileDocAccess.execute(args)
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const read = await readProjectFileContent.execute({
          ...args,
          input: { ...args.input, maxBytes: MAX_SEED_BYTES },
        })
        if (!isMarkdownFile(read.file)) {
          throw new OrchestrationError(
            'validation',
            'Collaborative documents must be Markdown files'
          )
        }
        const cached = await loadCollabDocState(args.input.fileId)
        const update = prepareFileDocSeed(args.input.fileId, read.content, cached)
        const accepted = await seedCache.execute({
          ...args,
          input: {
            ...args.input,
            expectedVersion: read.file.contentUpdatedAt.getTime(),
            state: {
              docState: update,
              sourceHash: hashMarkdown(read.content),
              expectedState: cached
                ? { sourceHash: cached.sourceHash, stateHash: cached.stateHash }
                : null,
            },
          },
        })
        return { update, version: accepted.version }
      } catch (error) {
        if (!isDocumentConflict(error)) throw error
      }
    }
    throw new OrchestrationError('conflict', 'File changed while preparing its document')
  },
}

/** Commit a snapshot through the same content, provenance, version and billing transaction as edits. */
export const persistProjectFileDoc: AuthorizingUseCase<
  typeof projectFileOperations.updateContent,
  ProjectDocumentPersistInput,
  PersistFileDocResult
> = {
  operation: projectFileOperations.updateContent,
  delegationAudience: projectFileOperations.updateContent.delegationAudience,
  async authorize(args) {
    const authorize = await createProjectFileAuthorizer(
      args.principal,
      projectFileOperations.updateContent,
      args.input
    )
    requireProjectDocument(await db.transaction(authorize))
  },
  async execute(args) {
    await this.authorize(args)
    if (args.input.expectedVersion === undefined) return { status: 'deferred' }
    assertCollabDocStateSize(args.input.docState)
    const doc = new Y.Doc()
    let markdown: Buffer
    try {
      Y.applyUpdate(doc, args.input.docState)
      markdown = Buffer.from(yDocToFileMarkdown(doc), 'utf-8')
    } finally {
      doc.destroy()
    }
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const read = await readProjectFileContent.execute(args)
        const version = read.file.contentUpdatedAt.getTime()
        if (!isMarkdownFile(read.file)) {
          throw new OrchestrationError(
            'validation',
            'Collaborative documents must be Markdown files'
          )
        }
        const cached = await loadCollabDocState(args.input.fileId)
        const sameContent = read.content.equals(markdown)
        const prepared = preparePersistedState(
          args.input.docState,
          cached,
          markdown,
          version !== args.input.expectedVersion && !sameContent
        )
        if (!prepared) return { status: 'conflict' }
        if (sameContent) {
          const accepted = await persistCache.execute({
            ...args,
            input: { ...args.input, expectedVersion: version, state: prepared },
          })
          return { status: 'persisted', version: accepted.version }
        }
        if (
          version !== args.input.expectedVersion &&
          cached?.sourceHash !== hashMarkdown(read.content)
        )
          return { status: 'conflict' }
        const updated = await updateProjectFileContent.execute({
          ...args,
          input: {
            ...args.input,
            content: markdown.toString('utf-8'),
            encoding: 'utf-8',
            expectedUpdatedAt: read.file.contentUpdatedAt,
            provenanceMode: 'preserve',
            collabDocState: prepared,
          },
        })
        return { status: 'persisted', version: updated.file.contentUpdatedAt.getTime() }
      } catch (error) {
        if (!isDocumentConflict(error)) throw error
      }
    }
    return { status: 'conflict' }
  },
}
