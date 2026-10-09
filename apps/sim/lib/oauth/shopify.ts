import { processCredentialDraft } from '@/lib/credentials/draft-processor'
import { connectShopifyInstallation } from '@/lib/oauth/shopify-installation'

interface CompleteShopifyOAuthConnectionParams {
  code: string
  shopDomain: string
  userId: string
  draftId?: string
  signal?: AbortSignal
}

/** Saves the verified installation before completing its exact credential draft. */
export async function completeShopifyOAuthConnection(
  params: CompleteShopifyOAuthConnectionParams
): Promise<void> {
  const accountId = await connectShopifyInstallation(params)
  await processCredentialDraft({
    draftId: params.draftId,
    userId: params.userId,
    providerId: 'shopify',
    accountId,
  })
}
