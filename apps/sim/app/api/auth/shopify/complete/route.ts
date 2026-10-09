import { completeShopifyInstallContract } from '@/lib/api/contracts/shopify-install'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { completeShopifyInstall } from '@/lib/credentials/application/complete-shopify-install'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { shopifyInstallCookieName } from '@/lib/oauth/shopify-install-protocol'

export const POST = defineInternalJsonRoute({
  contract: completeShopifyInstallContract,
  auth: internalSessionAuth,
  operation: credentialOperations.completeConnection,
  rateLimit: internalRateLimits.user({ bucketName: 'shopify-install-claim' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }, { request }) => ({
    ...body,
    browserProof: request.cookies.get(shopifyInstallCookieName(body.attemptId))?.value ?? '',
  }),
  useCase: completeShopifyInstall,
  present: (result) => ({ credentialId: result.credentialId, workspaceId: result.workspaceId }),
  responseHeaders: ({ input }) => ({
    'Cache-Control': 'private, no-store',
    'Set-Cookie': `${shopifyInstallCookieName(input.attemptId)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  }),
})
