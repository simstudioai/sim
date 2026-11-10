import { MarketplaceEntitlementServiceClient } from '@aws-sdk/client-marketplace-entitlement-service'
import { MarketplaceMeteringClient } from '@aws-sdk/client-marketplace-metering'
import { SQSClient } from '@aws-sdk/client-sqs'
import { fromHttp } from '@aws-sdk/credential-providers'
import { getAwsCredentials } from '@/lib/core/config/aws'
import { env } from '@/lib/core/config/env'
import { awsRequestHandler } from '@/lib/core/network/proxy-agent.server'

/**
 * The Entitlement Service exists only here. Metering is multi-region, but a registration token is
 * resolved here too, and infra runs the event queue in this region.
 */
const MARKETPLACE_REGION = 'us-east-1'

/**
 * A stalled connection fails instead of hanging. The SDK's default three attempts retry throttling,
 * 5xx, and these timeouts.
 */
const REQUEST_HANDLER = {
  connectionTimeout: 3_000,
  requestTimeout: 10_000,
  throwOnRequestTimeout: true,
}

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
function marketplaceClientConfig() {
  const relativeUri = env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI
  const fullUri = env.AWS_CONTAINER_CREDENTIALS_FULL_URI
  return {
    region: MARKETPLACE_REGION,
    requestHandler: awsRequestHandler(REQUEST_HANDLER),
    credentials:
      relativeUri || fullUri
        ? fromHttp({
            awsContainerCredentialsRelativeUri: relativeUri,
            awsContainerCredentialsFullUri: fullUri,
          })
        : getAwsCredentials(),
  }
}

/** Built on first use, so a deployment with the feature off never reaches for credentials. */
export function getMeteringClient(): MarketplaceMeteringClient {
  meteringClient ??= new MarketplaceMeteringClient(marketplaceClientConfig())
  return meteringClient
}

export function getEntitlementClient(): MarketplaceEntitlementServiceClient {
  entitlementClient ??= new MarketplaceEntitlementServiceClient(marketplaceClientConfig())
  return entitlementClient
}

export function getEventsQueueClient(): SQSClient {
  queueClient ??= new SQSClient(marketplaceClientConfig())
  return queueClient
}
