/**
 * Container entrypoint. Hydrates `process.env` from the runtime secret, refuses to start on a
 * malformed `AWS_MARKETPLACE_PRODUCTS` (so a bad deploy rolls back instead of failing buyers and
 * checkouts later), resolves an AWS Marketplace Enterprise license into `ENTERPRISE_ENABLED` on
 * Marketplace installs, and drops
 * Next's route cache when an earlier build wrote it, before loading the Next.js standalone server,
 * so application modules that read env at import time see the full configuration. See
 * `@sim/runtime-secrets`.
 */
import { fileURLToPath } from 'node:url'
import { loadRuntimeSecrets } from '@sim/runtime-secrets'
import { applyAwsMarketplaceContainerLicense } from '@/lib/billing/aws-marketplace/container-license'
import { parseAwsMarketplaceProducts } from '@/lib/billing/aws-marketplace/products'
import { clearRouteCacheFromOtherBuild } from '@/lib/core/utils/route-cache'

await loadRuntimeSecrets()
if (process.env.AWS_MARKETPLACE_PRODUCTS) {
  parseAwsMarketplaceProducts(process.env.AWS_MARKETPLACE_PRODUCTS)
}
await applyAwsMarketplaceContainerLicense()
await clearRouteCacheFromOtherBuild(fileURLToPath(new URL('./.next', import.meta.url)))
// `server.js` is the Next standalone build artifact, a sibling of this file in
// the image; it does not exist at type-check time, so the specifier is held in a
// variable to keep it out of static module resolution.
const standaloneServer = './server.js'
await import(standaloneServer)
