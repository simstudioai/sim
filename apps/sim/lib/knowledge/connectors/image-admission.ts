import { env, envNumber } from '@/lib/core/config/env'
import {
  type ImageExtractionPolicy,
  isSemanticImage,
} from '@/lib/knowledge/documents/image-extraction-policy'
import { getConnectorMeta } from '@/connectors/registry'
import type { ExternalDocument } from '@/connectors/types'

/** New images one sync may send for vision extraction; the rest wait for the next sync. */
const IMAGE_EXTRACTIONS_PER_SYNC = envNumber(env.KB_IMAGE_EXTRACTIONS_PER_SYNC, 500, {
  min: 0,
  integer: true,
})

/** A source's image policy, declared on its connector; uploads and undeclared sources keep OCR. */
export function imageExtractionPolicyFor(connectorType: string | null): ImageExtractionPolicy {
  return (connectorType && getConnectorMeta(connectorType)?.imageExtraction) || 'ocr'
}

/**
 * The part of a listing checkpoint that counts this sync's new images. Living on
 * the checkpoint keeps the count across a sync that yields and resumes in
 * another worker; a member-scoped sync counts per member listing.
 */
export interface ImageAdmissionState {
  imageExtractionsAdmitted: number
  imagesDeferred: boolean
}

/**
 * Whether a newly listed document may be hydrated in this sync. Only a new image
 * bound for vision extraction spends the budget; an over-budget one is never
 * downloaded or stored, so the next sync's listing offers it again as new.
 */
export function admitNewDocument(
  document: Pick<ExternalDocument, 'mimeType'>,
  policy: ImageExtractionPolicy,
  state: ImageAdmissionState | undefined
): boolean {
  if (!state || !isSemanticImage(policy, document.mimeType ?? '')) return true
  if (state.imageExtractionsAdmitted >= IMAGE_EXTRACTIONS_PER_SYNC) {
    state.imagesDeferred = true
    return false
  }
  state.imageExtractionsAdmitted += 1
  return true
}
