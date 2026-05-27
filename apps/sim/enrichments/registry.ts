import { companyDomainEnrichment } from '@/enrichments/company-domain'
import { companyInfoEnrichment } from '@/enrichments/company-info'
import { phoneNumberEnrichment } from '@/enrichments/phone-number'
import type { EnrichmentConfig, EnrichmentRegistry } from '@/enrichments/types'
import { workEmailEnrichment } from '@/enrichments/work-email'

export const ENRICHMENT_REGISTRY: EnrichmentRegistry = {
  [workEmailEnrichment.id]: workEmailEnrichment,
  [phoneNumberEnrichment.id]: phoneNumberEnrichment,
  [companyDomainEnrichment.id]: companyDomainEnrichment,
  [companyInfoEnrichment.id]: companyInfoEnrichment,
}

/** All enrichments, in catalog order. */
export const ALL_ENRICHMENTS: EnrichmentConfig[] = Object.values(ENRICHMENT_REGISTRY)

export function getEnrichment(id: string | undefined): EnrichmentConfig | undefined {
  return id ? ENRICHMENT_REGISTRY[id] : undefined
}
