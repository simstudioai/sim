import { CheckoutLicenseCommand, LicenseManagerClient } from '@aws-sdk/client-license-manager'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { randomInt } from '@sim/utils/random'
import { awsRequestHandler } from '@/lib/core/network/proxy-agent.server'

/**
 * Enterprise entitlement for Sim installed from the AWS Marketplace container listing.
 *
 * The listing sells an annual contract whose one dimension is `enterprise_license`. AWS Marketplace
 * grants the buyer a license in AWS License Manager, and the running product checks it the way AWS
 * documents for a contract that unlocks a tier of features rather than metering a quantity: a
 * provisional `CheckoutLicense` of the entitlement with unit `None`. Such a checkout is not counted
 * against the contract, so every replica can check at once, and it needs only the permission AWS's
 * managed `AWSLicenseManagerConsumptionPolicy` grants. While the license is active, the Enterprise
 * suite is on (`ENTERPRISE_ENABLED`). Without one, Sim runs as the open-source core, so a lapsed
 * renewal or an unreachable License Manager never locks a buyer out of their deployment.
 *
 * Opt-in: nothing here runs unless {@link PRODUCT_SKU_ENV} is set, which only the Marketplace
 * Helm profile does. Enterprise flags are read once at startup by both the server and the
 * browser, so instead of flipping them live, a re-check that sees the answer change asks the
 * process to shut down and the orchestrator starts it again in the right mode.
 */

const logger = createLogger('AwsMarketplaceContainerLicense')

/** Set by the Marketplace Helm profile to the listing's product ID (the License Manager SKU). */
const PRODUCT_SKU_ENV = 'AWS_MARKETPLACE_LICENSE_PRODUCT_SKU'

/**
 * Optional override for where the license is checked. License Manager replicates a granted license
 * to other Regions, so the default is the pod's own Region, the same chain AWS's EKS walkthrough uses.
 */
const LICENSE_REGION_ENV = 'AWS_MARKETPLACE_LICENSE_REGION'

/** The issuer every AWS Marketplace license is signed by (a fixed value, not a placeholder). */
const MARKETPLACE_KEY_FINGERPRINT = 'aws:294406891311:AWS/Marketplace:issuer-fingerprint'

/** The listing's contract dimension API name. */
const ENTERPRISE_ENTITLEMENT = 'enterprise_license'

/** AWS recommends re-checking every 15 minutes to pick up renewals, upgrades, and cancellations. */
const RECHECK_INTERVAL_MS = 15 * 60 * 1000

/** Replicas start together; a random part of this added to each re-check keeps them apart. */
const RECHECK_JITTER_MS = 2 * 60 * 1000

/**
 * Replicas see a change together; each waits a random part of this before restarting, so a renewal
 * or lapse never takes every replica down at once.
 */
const RESTART_SPREAD_MS = 10 * 60 * 1000

const ENTERPRISE_FLAGS = ['ENTERPRISE_ENABLED', 'NEXT_PUBLIC_ENTERPRISE_ENABLED'] as const

/** License Manager's answers when the account holds no active license with the entitlement. */
const NO_ENTITLEMENT_ERRORS = new Set([
  'NoEntitlementsAllowedException',
  'ResourceNotFoundException',
])

/** The ServiceAccount's IAM role does not allow the check: a setup problem, never a verdict. */
const PERMISSION_ERRORS = new Set(['AccessDeniedException', 'AuthorizationException'])

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

function classifyFailure(error: unknown): LicenseState {
  const name = error instanceof Error ? error.name : undefined
  if (name && NO_ENTITLEMENT_ERRORS.has(name)) {
    logger.info('AWS License Manager reports no active Enterprise entitlement', { error: name })
    return 'not-entitled'
  }
  if (name && PERMISSION_ERRORS.has(name)) {
    logger.error(
      'The IAM role cannot check the AWS Marketplace license; allow license-manager:CheckoutLicense',
      { error: name }
    )
    return 'unknown'
  }
  logger.warn('Could not check the AWS Marketplace Enterprise license', {
    error: name,
    message: getErrorMessage(error, 'Unknown error'),
  })
  return 'unknown'
}

async function checkLicense(
  client: LicenseManagerClient,
  productSku: string
): Promise<LicenseState> {
  try {
    const checkout = await client.send(
      new CheckoutLicenseCommand({
        ProductSKU: productSku,
        CheckoutType: 'PROVISIONAL',
        KeyFingerprint: MARKETPLACE_KEY_FINGERPRINT,
        Entitlements: [{ Name: ENTERPRISE_ENTITLEMENT, Unit: 'None' }],
        ClientToken: generateId(),
      })
    )
    const allowed = (checkout.EntitlementsAllowed ?? []).some(
      (entitlement) => entitlement.Name === ENTERPRISE_ENTITLEMENT
    )
    return allowed ? 'entitled' : 'not-entitled'
  } catch (error) {
    return classifyFailure(error)
  }
}

function setEnterpriseFlags(enabled: boolean): void {
  for (const flag of ENTERPRISE_FLAGS) process.env[flag] = enabled ? 'true' : 'false'
}

function restartToApply(state: LicenseState): void {
  const delayMs = randomInt(0, RESTART_SPREAD_MS)
  logger.info('AWS Marketplace Enterprise license changed; restarting to apply it', {
    state,
    delayMs,
  })
  setTimeout(() => process.kill(process.pid, 'SIGTERM'), delayMs)
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

  const scheduleRecheck = () => {
    setTimeout(recheck, RECHECK_INTERVAL_MS + randomInt(0, RECHECK_JITTER_MS)).unref()
  }
  const recheck = async () => {
    const state = await checkLicense(client, productSku)
    // A failed check keeps the current mode; only a definite answer that differs restarts.
    const changed =
      (state === 'entitled' && !enterpriseAtBoot) || (state === 'not-entitled' && enterpriseAtBoot)
    if (changed) return restartToApply(state)
    scheduleRecheck()
  }
  scheduleRecheck()
}
