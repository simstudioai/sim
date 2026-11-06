import { MarketplaceEntitlementServiceClient } from '@aws-sdk/client-marketplace-entitlement-service'
import { MarketplaceMeteringClient } from '@aws-sdk/client-marketplace-metering'
import { SQSClient } from '@aws-sdk/client-sqs'
import { getAwsCredentials } from '@/lib/core/config/aws'

/** The Marketplace metering and entitlement endpoints for SaaS products live only here. */
const MARKETPLACE_REGION = 'us-east-1'

let meteringClient: MarketplaceMeteringClient | null = null
let entitlementClient: MarketplaceEntitlementServiceClient | null = null
let queueClient: SQSClient | null = null

/**
 * Credentials come from `getAwsCredentials()`: the SDK's default chain, which on ECS resolves the
 * task role. Clients are built on first use, so a deployment with the feature off never reaches
 * for credentials.
 */
export function getMeteringClient(): MarketplaceMeteringClient {
  meteringClient ??= new MarketplaceMeteringClient({
    region: MARKETPLACE_REGION,
    credentials: getAwsCredentials(),
  })
  return meteringClient
}

/** Single attempt per call: `fetchLicenseEntitlements` owns the retry loop and its pacing. */
export function getEntitlementClient(): MarketplaceEntitlementServiceClient {
  entitlementClient ??= new MarketplaceEntitlementServiceClient({
    region: MARKETPLACE_REGION,
    credentials: getAwsCredentials(),
    maxAttempts: 1,
  })
  return entitlementClient
}

export function getEventsQueueClient(): SQSClient {
  queueClient ??= new SQSClient({ region: MARKETPLACE_REGION, credentials: getAwsCredentials() })
  return queueClient
}
