import { isRecordLike } from '@sim/utils/object'
import { projectEnrichmentProviderFailure } from '@/enrichments/providers'
import type {
  EnrichmentProviderFailure,
  EnrichmentProviderFailureProjection,
} from '@/enrichments/types'

/** Projects Prospeo's documented `NO_MATCH` error as a clean provider miss. */
export function projectProspeoEnrichmentFailure(
  failure: EnrichmentProviderFailure
): EnrichmentProviderFailureProjection {
  if (
    isRecordLike(failure.output) &&
    isRecordLike(failure.output.data) &&
    failure.output.data.error_code === 'NO_MATCH'
  ) {
    return { status: 'no_match' }
  }
  return projectEnrichmentProviderFailure(failure)
}
