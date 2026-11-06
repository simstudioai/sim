import { listOrganizationAwsMarketplaceLicensesContract } from '@/lib/api/contracts/aws-marketplace'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { listOrganizationAwsMarketplaceLicenses } from '@/lib/billing/aws-marketplace/application/use-cases'

export const GET = defineInternalJsonRoute({
  contract: listOrganizationAwsMarketplaceLicensesContract,
  operation: listOrganizationAwsMarketplaceLicenses.operation,
  useCase: listOrganizationAwsMarketplaceLicenses,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.user({ bucketName: 'aws-marketplace-licenses' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
  mapInput: ({ params }) => ({ organizationId: params.id }),
  present: (licenses) => ({ licenses }),
})
