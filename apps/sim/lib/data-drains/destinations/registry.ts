import { s3Destination } from '@/lib/data-drains/destinations/s3'
import { webhookDestination } from '@/lib/data-drains/destinations/webhook'
import type { DestinationType, DrainDestination } from '@/lib/data-drains/types'

export const DESTINATION_REGISTRY = {
  s3: s3Destination,
  webhook: webhookDestination,
} as const satisfies Record<DestinationType, DrainDestination>

export function getDestination(type: DestinationType): DrainDestination {
  return DESTINATION_REGISTRY[type]
}
