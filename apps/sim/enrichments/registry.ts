import { phoneNumberEnrichment } from '@/enrichments/phone-number'
import type { EnrichmentConfig, EnrichmentRegistry } from '@/enrichments/types'
import { workEmailEnrichment } from '@/enrichments/work-email'

export const ENRICHMENT_REGISTRY: EnrichmentRegistry = {
  [workEmailEnrichment.id]: workEmailEnrichment,
  [phoneNumberEnrichment.id]: phoneNumberEnrichment,
}

/** All enrichments, in catalog order. */
export const ALL_ENRICHMENTS: EnrichmentConfig[] = Object.values(ENRICHMENT_REGISTRY)

export function getEnrichment(id: string | undefined): EnrichmentConfig | undefined {
  return id ? ENRICHMENT_REGISTRY[id] : undefined
}
