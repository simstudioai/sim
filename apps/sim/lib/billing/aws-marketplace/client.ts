import { MarketplaceEntitlementServiceClient } from '@aws-sdk/client-marketplace-entitlement-service'
import { MarketplaceMeteringClient } from '@aws-sdk/client-marketplace-metering'
import { SQSClient } from '@aws-sdk/client-sqs'
import { fromHttp } from '@aws-sdk/credential-provider-http'
import { getAwsCredentials } from '@/lib/core/config/aws'
import { env } from '@/lib/core/config/env'

/** The Marketplace metering and entitlement endpoints for SaaS products live only here. */
const MARKETPLACE_REGION = 'us-east-1'

let meteringClient: MarketplaceMeteringClient | null = null
let entitlementClient: MarketplaceEntitlementServiceClient | null = null
let queueClient: SQSClient | null = null

/**
 * Credentials for the Marketplace and event-queue clients only. On ECS the app's env also carries
 * a static IAM user's keys, which the SDK's default chain prefers and which Sim's general AWS
 * clients (`getAwsCredentials()`) sign with. Infra grants ResolveCustomer, GetEntitlements, and the
 * queue permissions to the ECS task role alone, and AWS asks for temporary role credentials here,
 * so whenever the container credential endpoint is present these clients sign as the task role.
 * Elsewhere (local development, tests) they keep the default chain.
 */
function marketplaceCredentials() {
  const relativeUri = env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI
  const fullUri = env.AWS_CONTAINER_CREDENTIALS_FULL_URI
  if (relativeUri || fullUri) {
    return fromHttp({
      awsContainerCredentialsRelativeUri: relativeUri,
      awsContainerCredentialsFullUri: fullUri,
    })
  }
  return getAwsCredentials()
}

/** Built on first use, so a deployment with the feature off never reaches for credentials. */
export function getMeteringClient(): MarketplaceMeteringClient {
  meteringClient ??= new MarketplaceMeteringClient({
    region: MARKETPLACE_REGION,
    credentials: marketplaceCredentials(),
  })
  return meteringClient
}

/** Single attempt per call: `fetchLicenseEntitlements` owns the retry loop and its pacing. */
export function getEntitlementClient(): MarketplaceEntitlementServiceClient {
  entitlementClient ??= new MarketplaceEntitlementServiceClient({
    region: MARKETPLACE_REGION,
    credentials: marketplaceCredentials(),
    maxAttempts: 1,
  })
  return entitlementClient
}

export function getEventsQueueClient(): SQSClient {
  queueClient ??= new SQSClient({
    region: MARKETPLACE_REGION,
    credentials: marketplaceCredentials(),
  })
  return queueClient
}
