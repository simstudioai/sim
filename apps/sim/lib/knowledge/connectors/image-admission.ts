import { env, envNumber } from '@/lib/core/config/env'
import { EmbeddingConfigurationError } from '@/lib/embeddings/configuration-error'
import { resolveProviderKey } from '@/lib/embeddings/keys'
import {
  type ImageExtractionPolicy,
  isSemanticImage,
} from '@/lib/knowledge/documents/image-extraction-policy'
import { getConnectorMeta } from '@/connectors/registry'
import type { ExternalDocument } from '@/connectors/types'

/** Images one sync may send for vision extraction, new or changed; the rest wait for the next sync. */
const IMAGE_EXTRACTIONS_PER_SYNC = envNumber(env.KB_IMAGE_EXTRACTIONS_PER_SYNC, 500, {
  min: 0,
  integer: true,
})

/** A source's image policy, declared on its connector; uploads and undeclared sources keep OCR. */
export function imageExtractionPolicyFor(connectorType: string | null): ImageExtractionPolicy {
  return (connectorType && getConnectorMeta(connectorType)?.imageExtraction) || 'ocr'
}

/** Whether a listed document is an image this source reads with the vision model. */
export function isVisionImage(
  document: Pick<ExternalDocument, 'mimeType'>,
  policy: ImageExtractionPolicy
): boolean {
  return isSemanticImage(policy, document.mimeType ?? '')
}

/**
 * Whether the workspace can have images read at all: its own Gemini key, or one
 * on the deployment. Without either, images are left unlisted rather than failed.
 */
export async function canExtractImages(workspaceId: string | null): Promise<boolean> {
  try {
    await resolveProviderKey('gemini', workspaceId)
    return true
  } catch (error) {
    if (error instanceof EmbeddingConfigurationError) return false
    throw error
  }
}

/**
 * The part of a listing checkpoint that counts this sync's image extractions.
 * Living on the checkpoint keeps the count across a sync that yields and resumes
 * in another worker.
 */
export interface ImageAdmissionState {
  imageExtractionsAdmitted: number
  imagesDeferred: boolean
}

/**
 * Whether a new or changed vision image may be hydrated in this sync. Each one
 * spends the per-sync budget; an over-budget one is never downloaded, so the next
 * sync's listing offers it again. Absent state means no cap.
 */
export function admitVisionImage(state: ImageAdmissionState | undefined): boolean {
  if (!state) return true
  if (state.imageExtractionsAdmitted >= IMAGE_EXTRACTIONS_PER_SYNC) {
    state.imagesDeferred = true
    return false
  }
  state.imageExtractionsAdmitted += 1
  return true
}
