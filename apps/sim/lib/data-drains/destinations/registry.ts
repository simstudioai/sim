import { azureBlobDestination } from '@/lib/data-drains/destinations/azure_blob'
import { bigqueryDestination } from '@/lib/data-drains/destinations/bigquery'
import { datadogDestination } from '@/lib/data-drains/destinations/datadog'
import { gcsDestination } from '@/lib/data-drains/destinations/gcs'
import { s3Destination } from '@/lib/data-drains/destinations/s3'
import { snowflakeDestination } from '@/lib/data-drains/destinations/snowflake'
import { webhookDestination } from '@/lib/data-drains/destinations/webhook'
import type { DestinationType, DrainDestination } from '@/lib/data-drains/types'

export const DESTINATION_REGISTRY = {
  s3: s3Destination,
  gcs: gcsDestination,
  azure_blob: azureBlobDestination,
  datadog: datadogDestination,
  bigquery: bigqueryDestination,
  snowflake: snowflakeDestination,
  webhook: webhookDestination,
} as const satisfies Record<DestinationType, DrainDestination>

export function getDestination(type: DestinationType): DrainDestination {
  return DESTINATION_REGISTRY[type]
}
