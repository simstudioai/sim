import { GoogleBigQueryIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GoogleBigQueryBlockDisplay = {
  type: 'google_bigquery',
  name: 'Google BigQuery',
  description: 'Query, list, and insert data in Google BigQuery',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleBigQueryIcon,
  longDescription:
    'Connect to Google BigQuery to run SQL queries, list datasets and tables, get table metadata, and insert rows.',
  docsLink: 'https://docs.sim.ai/integrations/google_bigquery',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay
