import { azureBlobDestination } from '@/ee/data-drains/lib/destinations/azure_blob'
import { bigqueryDestination } from '@/ee/data-drains/lib/destinations/bigquery'
import { datadogDestination } from '@/ee/data-drains/lib/destinations/datadog'
import { gcsDestination } from '@/ee/data-drains/lib/destinations/gcs'
import { s3Destination } from '@/ee/data-drains/lib/destinations/s3'
import { snowflakeDestination } from '@/ee/data-drains/lib/destinations/snowflake'
import { webhookDestination } from '@/ee/data-drains/lib/destinations/webhook'
import type { DestinationType, DrainDestination } from '@/ee/data-drains/lib/types'

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
