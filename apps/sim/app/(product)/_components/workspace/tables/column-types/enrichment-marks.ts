import type { IconName } from '@sim/emcn/icon'

/** A mark the Icon owner draws: an interface glyph or a provider's brand. */
export type EnrichmentMark = IconName | { providerId: string }

/** Each catalog enrichment's EMCN mark; the registry names a legacy icon. */
const ENRICHMENT_MARKS: Partial<Record<string, EnrichmentMark>> = {
  'company-domain': 'I041',
  'company-info': 'I025',
  'email-verification': 'I136',
  'linkedin-profile': { providerId: 'linkedin' },
  'work-email': 'I073',
}

/** The mark for an enrichment by registry id, falling back to the enrichments glyph. */
export function enrichmentMark(id: string | undefined): EnrichmentMark {
  return (id && ENRICHMENT_MARKS[id]) || 'sparkles'
}
