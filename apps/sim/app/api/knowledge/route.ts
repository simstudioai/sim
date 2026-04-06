import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { getSession } from '@/lib/auth'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  createKBEmbeddingTable,
  dropKBEmbeddingTable,
  parseEmbeddingModel,
} from '@/lib/knowledge/dynamic-tables'
import { getOllamaBaseUrl, isAllowedOllamaUrl, validateOllamaModel } from '@/lib/knowledge/embeddings'
import {
  createKnowledgeBase,
  getKnowledgeBases,
  hardDeleteKnowledgeBase,
  KnowledgeBaseConflictError,
  type KnowledgeBaseScope,
} from '@/lib/knowledge/service'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('KnowledgeBaseAPI')

/**
 * Schema for creating a knowledge base
 *
 * Chunking config units:
 * - maxSize: tokens (1 token ≈ 4 characters)
 * - minSize: characters
 * - overlap: tokens (1 token ≈ 4 characters)
 */
const CreateKnowledgeBaseSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  embeddingModel: z
    .union([
      z.literal('text-embedding-3-small'),
      z.literal('text-embedding-3-large'),
      z.string().regex(/^ollama\/.+/, 'Ollama models must be prefixed with "ollama/"'),
    ])
    .default('text-embedding-3-small'),
  embeddingDimension: z.number().int().min(64).max(8192).default(1536),
  ollamaBaseUrl: z
    .string()
    .url('Ollama base URL must be a valid URL')
    .refine(isAllowedOllamaUrl, {
      message:
        'Ollama base URL must point to localhost, a private network address, or a Docker service hostname',
    })
    .optional(),
  chunkingConfig: z
    .object({
      /** Maximum chunk size in tokens (1 token ≈ 4 characters) */
      maxSize: z.number().min(100).max(4000).default(1024),
      /** Minimum chunk size in characters */
      minSize: z.number().min(1).max(2000).default(100),
      /** Overlap between chunks in tokens (1 token ≈ 4 characters) */
      overlap: z.number().min(0).max(500).default(200),
    })
    .default({
      maxSize: 1024,
      minSize: 100,
      overlap: 200,
    })
    .refine(
      (data) => {
        // Convert maxSize from tokens to characters for comparison (1 token ≈ 4 chars)
        const maxSizeInChars = data.maxSize * 4
        return data.minSize < maxSizeInChars
      },
      {
        message: 'Min chunk size (characters) must be less than max chunk size (tokens × 4)',
      }
    ),
})

export async function GET(req: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized knowledge base access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const workspaceId = searchParams.get('workspaceId')
    const scope = (searchParams.get('scope') ?? 'active') as KnowledgeBaseScope
    if (!['active', 'archived', 'all'].includes(scope)) {
      return NextResponse.json({ error: 'Invalid scope' }, { status: 400 })
    }

    const knowledgeBasesWithCounts = await getKnowledgeBases(session.user.id, workspaceId, scope)

    return NextResponse.json({
      success: true,
      data: knowledgeBasesWithCounts,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching knowledge bases`, error)
    return NextResponse.json({ error: 'Failed to fetch knowledge bases' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized knowledge base creation attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    try {
      const validatedData = CreateKnowledgeBaseSchema.parse(body)

      const { provider, modelName } = parseEmbeddingModel(validatedData.embeddingModel)

      // For Ollama models, validate the model is available and auto-detect dimension
      let effectiveDimension = validatedData.embeddingDimension
      if (provider === 'ollama') {
        const ollamaBaseUrl = getOllamaBaseUrl(validatedData.ollamaBaseUrl)
        try {
          const modelInfo = await validateOllamaModel(modelName, ollamaBaseUrl)

          // Auto-correct dimension if the model reports a different one
          if (modelInfo.embeddingLength && modelInfo.embeddingLength !== effectiveDimension) {
            if (modelInfo.embeddingLength < 64 || modelInfo.embeddingLength > 8192) {
              return NextResponse.json(
                {
                  error: `Ollama model "${modelName}" reported an unsupported embedding dimension (${modelInfo.embeddingLength}). Supported range: 64–8192.`,
                },
                { status: 400 }
              )
            }
            logger.info(
              `[${requestId}] Auto-correcting embedding dimension from ${effectiveDimension} ` +
                `to ${modelInfo.embeddingLength} (reported by Ollama model ${modelName})`
            )
            effectiveDimension = modelInfo.embeddingLength
          }
        } catch {
          return NextResponse.json(
            {
              error:
                `Cannot reach Ollama at ${ollamaBaseUrl} or model "${modelName}" is not available. ` +
                `Make sure Ollama is running and the model is pulled (ollama pull ${modelName}).`,
            },
            { status: 400 }
          )
        }
      }

      const createData = {
        ...validatedData,
        embeddingDimension: effectiveDimension,
        userId: session.user.id,
      }

      const newKnowledgeBase = await createKnowledgeBase(createData, requestId)

      if (provider === 'ollama') {
        try {
          await createKBEmbeddingTable(newKnowledgeBase.id, effectiveDimension)
        } catch (tableError) {
          logger.error(
            `[${requestId}] Failed to create embedding table for KB ${newKnowledgeBase.id}`,
            tableError
          )
          // Hard-delete the KB row — this is a creation-time rollback, not a user-initiated
          // deletion, so a soft delete would leave a restorable broken KB in the archive.
          try {
            await dropKBEmbeddingTable(newKnowledgeBase.id)
            await hardDeleteKnowledgeBase(newKnowledgeBase.id)
            logger.info(
              `[${requestId}] Cleaned up orphaned KB ${newKnowledgeBase.id} after table creation failure`
            )
          } catch (cleanupError) {
            logger.error(
              `[${requestId}] Failed to clean up orphaned KB ${newKnowledgeBase.id}`,
              cleanupError
            )
          }
          return NextResponse.json(
            { error: 'Failed to create embedding storage. Please try again.' },
            { status: 500 }
          )
        }
      }

      try {
        PlatformEvents.knowledgeBaseCreated({
          knowledgeBaseId: newKnowledgeBase.id,
          name: validatedData.name,
          workspaceId: validatedData.workspaceId,
        })
      } catch {
        // Telemetry should not fail the operation
      }

      captureServerEvent(
        session.user.id,
        'knowledge_base_created',
        {
          knowledge_base_id: newKnowledgeBase.id,
          workspace_id: validatedData.workspaceId,
          name: validatedData.name,
        },
        {
          groups: { workspace: validatedData.workspaceId },
          setOnce: { first_kb_created_at: new Date().toISOString() },
        }
      )

      logger.info(
        `[${requestId}] Knowledge base created: ${newKnowledgeBase.id} for user ${session.user.id}`
      )

      recordAudit({
        workspaceId: validatedData.workspaceId,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.KNOWLEDGE_BASE_CREATED,
        resourceType: AuditResourceType.KNOWLEDGE_BASE,
        resourceId: newKnowledgeBase.id,
        resourceName: validatedData.name,
        description: `Created knowledge base "${validatedData.name}"`,
        metadata: { name: validatedData.name },
        request: req,
      })

      return NextResponse.json({
        success: true,
        data: newKnowledgeBase,
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid knowledge base data`, {
          errors: validationError.errors,
        })
        return NextResponse.json(
          { error: 'Invalid request data', details: validationError.errors },
          { status: 400 }
        )
      }
      throw validationError
    }
  } catch (error) {
    if (error instanceof KnowledgeBaseConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }

    logger.error(`[${requestId}] Error creating knowledge base`, error)
    return NextResponse.json({ error: 'Failed to create knowledge base' }, { status: 500 })
  }
}
