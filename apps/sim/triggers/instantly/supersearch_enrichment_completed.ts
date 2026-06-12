import { createInstantlyTrigger } from '@/triggers/instantly/trigger'

export const instantlySupersearchEnrichmentCompletedTrigger = createInstantlyTrigger({
  id: 'instantly_supersearch_enrichment_completed',
  name: 'Instantly Supersearch Enrichment Completed',
  description: 'Trigger when Instantly completes a Supersearch enrichment',
  eventLabel: 'Supersearch Enrichment Completed',
})
