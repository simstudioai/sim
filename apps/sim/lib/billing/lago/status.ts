import { env } from '@/lib/core/config/env'

export interface LagoStatus {
  enabled: boolean
  configured: boolean
  apiUrl: string | null
  webhookSecretSet: boolean
}

export function getLagoStatus(): LagoStatus {
  const enabled = env.BILLING_PROVIDER === 'lago'
  const apiKey = env.LAGO_API_KEY
  const apiUrl = env.LAGO_API_URL || null
  const webhookSecret = env.LAGO_WEBHOOK_SECRET

  return {
    enabled,
    configured: enabled && !!apiKey && !!apiUrl,
    apiUrl: enabled ? apiUrl : null,
    webhookSecretSet: enabled && !!webhookSecret,
  }
}
