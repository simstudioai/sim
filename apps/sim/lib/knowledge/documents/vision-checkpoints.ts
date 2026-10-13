import { sha256Hex } from '@sim/security/hash'
import { z } from 'zod'
import type { OutboxHandler } from '@/lib/core/outbox/service'
import { VISION_CHECKPOINT_CLEANUP_EVENT } from '@/lib/knowledge/documents/checkpoint-events'
import type { OcrCheckpointContext } from '@/lib/knowledge/documents/ocr-checkpoints'
import {
  createCheckpointCleanupHandler,
  readFramedCheckpoint,
  writeFramedCheckpoint,
} from '@/lib/knowledge/documents/processing-checkpoint-store'
import { getKnowledgeOpaqueModelInputRegistry } from '@/lib/knowledge/model-input-provenance'

const MAX_CHECKPOINT_BYTES = 4 * 1024 * 1024
const KEY_PATTERN = /^knowledge-vision-checkpoints\/v1\/[a-f0-9]{64}\.json$/

const visionUsageSchema = z.object({
  model: z.string().min(1),
  cost: z.number().finite().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
})

/** What one vision extraction cost; carried through a checkpoint so a resumed pass bills it once. */
export type VisionExtractionUsage = z.infer<typeof visionUsageSchema>

const checkpointBodySchema = z.object({
  decorative: z.boolean(),
  renderedText: z.string(),
  usage: visionUsageSchema,
})

/** A validated extraction, reduced to what indexing keeps. */
export type VisionExtractionCheckpoint = z.infer<typeof checkpointBodySchema>

/**
 * Retry cache for one image's vision extraction, never a record: a pass that dies
 * after the paid call but before the index swap resumes from it instead of paying
 * again. Source bytes, the canonical document/pass identity, the model and the
 * extraction contract version all participate in the address.
 */
export function createVisionCheckpoint(options: {
  context: OcrCheckpointContext
  source: Buffer
  model: string
  contractVersion: string
}) {
  const { context, source, model, contractVersion } = options
  if (!context.knowledgeBaseId || !context.documentId || !context.indexingPassId) {
    throw new Error('Vision checkpoint requires a canonical processing identity')
  }
  const identity = sha256Hex(
    JSON.stringify({
      version: 1,
      ...context,
      sourceHash: sha256Hex(source),
      model,
      contractVersion,
    })
  )
  const key = `knowledge-vision-checkpoints/v1/${identity}.json`

  return {
    async load(signal?: AbortSignal): Promise<VisionExtractionCheckpoint | null> {
      getKnowledgeOpaqueModelInputRegistry()
      const stored = await readFramedCheckpoint(key, {
        maxBodyBytes: MAX_CHECKPOINT_BYTES,
        signal,
      })
      if (!stored || stored.header.identity !== identity) return null
      try {
        const parsed = checkpointBodySchema.safeParse(JSON.parse(stored.body.toString('utf8')))
        return parsed.success ? parsed.data : null
      } catch {
        return null
      }
    },

    async save(result: VisionExtractionCheckpoint, signal?: AbortSignal): Promise<void> {
      getKnowledgeOpaqueModelInputRegistry()
      const body = Buffer.from(JSON.stringify(checkpointBodySchema.parse(result)), 'utf8')
      if (body.length > MAX_CHECKPOINT_BYTES) return
      await writeFramedCheckpoint(key, { identity }, body, {
        cleanupEventType: VISION_CHECKPOINT_CLEANUP_EVENT,
        cleanupIdPrefix: 'knowledge-vision-cleanup',
        fileName: 'vision-checkpoint.json',
        signal,
      })
    },
  }
}

export const cleanupVisionCheckpoint: OutboxHandler = createCheckpointCleanupHandler({
  keyPattern: KEY_PATTERN,
  label: 'Vision',
})
