import { randomBytes } from 'node:crypto'

export const FOUNDATION_TEST_PASSWORD = 'E2eFoundation1!'

export interface E2eRuntimeSecrets {
  betterAuthSecret: string
  encryptionKey: string
  apiEncryptionKey: string
  internalApiSecret: string
  adminApiKey: string
  stripeSecretKey: string
  stripeWebhookSecret: string
}

export function createE2eRuntimeSecrets(): E2eRuntimeSecrets {
  return {
    betterAuthSecret: randomBytes(32).toString('hex'),
    encryptionKey: randomBytes(32).toString('hex'),
    apiEncryptionKey: randomBytes(32).toString('hex'),
    internalApiSecret: randomBytes(32).toString('hex'),
    adminApiKey: randomBytes(32).toString('hex'),
    stripeSecretKey: `sk_test_sim_e2e_${randomBytes(24).toString('hex')}`,
    stripeWebhookSecret: `whsec_sim_e2e_${randomBytes(24).toString('hex')}`,
  }
}

export function runtimeSecretValues(secrets: E2eRuntimeSecrets): string[] {
  return Object.values(secrets)
}
