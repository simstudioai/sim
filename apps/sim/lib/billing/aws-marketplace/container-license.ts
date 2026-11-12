import {
  CheckInLicenseCommand,
  CheckoutLicenseCommand,
  LicenseManagerClient,
  NoEntitlementsAllowedException,
} from '@aws-sdk/client-license-manager'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { awsRequestHandler } from '@/lib/core/network/proxy-agent.server'

/**
 * Enterprise entitlement for Sim installed from the AWS Marketplace container listing.
 *
 * The listing sells an annual contract whose one dimension is `enterprise_license`. AWS Marketplace
 * grants the buyer a license in AWS License Manager, and the running product checks it out. While
 * the license is active, the Enterprise suite is on (`ENTERPRISE_ENABLED`). Without one, Sim runs
 * as the open-source core, so a lapsed renewal or an unreachable License Manager never locks a
 * buyer out of their deployment.
 *
 * Opt-in: nothing here runs unless {@link PRODUCT_SKU_ENV} is set, which only the Marketplace
 * Helm profile does. Enterprise flags are read once at startup by both the server and the
 * browser, so instead of flipping them live, a re-check that sees the answer change asks the
 * process to shut down and the orchestrator starts it again in the right mode.
 */

const logger = createLogger('AwsMarketplaceContainerLicense')

/** Set by the Marketplace Helm profile to the listing's product ID (the License Manager SKU). */
const PRODUCT_SKU_ENV = 'AWS_MARKETPLACE_LICENSE_PRODUCT_SKU'

/** Optional override for where the license is read; defaults to the pod's own region. */
const LICENSE_REGION_ENV = 'AWS_MARKETPLACE_LICENSE_REGION'

/** The issuer every AWS Marketplace license is signed by (a fixed value, not a placeholder). */
const MARKETPLACE_KEY_FINGERPRINT = 'aws:294406891311:AWS/Marketplace:issuer-fingerprint'

/** The listing's contract dimension API name. */
const ENTERPRISE_ENTITLEMENT = 'enterprise_license'

/** AWS recommends re-checking every 15 minutes to pick up renewals, upgrades, and cancellations. */
const RECHECK_INTERVAL_MS = 15 * 60 * 1000

const ENTERPRISE_FLAGS = ['ENTERPRISE_ENABLED', 'NEXT_PUBLIC_ENTERPRISE_ENABLED'] as const

/** `unknown` is a failed check (network, permissions, throttling), never a verdict on the license. */
type LicenseState = 'entitled' | 'not-entitled' | 'unknown'

function createClient(): LicenseManagerClient {
  const region =
    process.env[LICENSE_REGION_ENV] ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    'us-east-1'
  return new LicenseManagerClient({
    region,
    requestHandler: awsRequestHandler({ connectionTimeout: 3_000, requestTimeout: 10_000 }),
  })
}

/**
 * Checks out one unit of the Enterprise entitlement and returns it straight away. The check-out is
 * the proof AWS asks for; returning the unit keeps several replicas from competing for a
 * single-unit contract.
 */
async function checkLicense(
  client: LicenseManagerClient,
  productSku: string
): Promise<LicenseState> {
  try {
    const result = await client.send(
      new CheckoutLicenseCommand({
        ProductSKU: productSku,
        CheckoutType: 'PROVISIONAL',
        KeyFingerprint: MARKETPLACE_KEY_FINGERPRINT,
        Entitlements: [{ Name: ENTERPRISE_ENTITLEMENT, Value: '1', Unit: 'Count' }],
        ClientToken: generateId(),
      })
    )
    const entitled = (result.EntitlementsAllowed ?? []).some(
      (entitlement) => entitlement.Name === ENTERPRISE_ENTITLEMENT
    )
    if (result.LicenseConsumptionToken) {
      await client
        .send(
          new CheckInLicenseCommand({ LicenseConsumptionToken: result.LicenseConsumptionToken })
        )
        .catch((error: unknown) => {
          // An unreturned unit goes back to the pool on its own after an hour.
          logger.warn('Could not check the Enterprise license back in', {
            message: getErrorMessage(error, 'Unknown error'),
          })
        })
    }
    return entitled ? 'entitled' : 'not-entitled'
  } catch (error) {
    if (error instanceof NoEntitlementsAllowedException) return 'not-entitled'
    logger.warn('Could not check the AWS Marketplace Enterprise license', {
      message: getErrorMessage(error, 'Unknown error'),
    })
    return 'unknown'
  }
}

function setEnterpriseFlags(enabled: boolean): void {
  for (const flag of ENTERPRISE_FLAGS) process.env[flag] = enabled ? 'true' : 'false'
}

/**
 * Resolves the Enterprise license before the server loads, so every Enterprise gate reads the
 * answer through `ENTERPRISE_ENABLED`, then keeps re-checking. Returns without doing anything on a
 * deployment that is not a Marketplace install.
 */
export async function applyAwsMarketplaceContainerLicense(): Promise<void> {
  const productSku = process.env[PRODUCT_SKU_ENV]
  if (!productSku) return

  const client = createClient()
  const bootState = await checkLicense(client, productSku)
  const enterpriseAtBoot = bootState === 'entitled'
  setEnterpriseFlags(enterpriseAtBoot)
  logger.info(
    enterpriseAtBoot
      ? 'AWS Marketplace Enterprise license active; Enterprise features on'
      : 'No active AWS Marketplace Enterprise license; running without Enterprise features',
    { state: bootState }
  )

  const recheck = setInterval(async () => {
    const state = await checkLicense(client, productSku)
    const entitledNow = state === 'entitled'
    if (state === 'unknown' || entitledNow === enterpriseAtBoot) return
    logger.info('AWS Marketplace Enterprise license changed; restarting to apply it', { state })
    clearInterval(recheck)
    process.kill(process.pid, 'SIGTERM')
  }, RECHECK_INTERVAL_MS)
  recheck.unref()
}
