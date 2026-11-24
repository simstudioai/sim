import { parseAsBoolean } from 'nuqs/server'
import { AUTO_PAY_RETURN_PARAM } from '@/lib/api/contracts/organization'

/**
 * The marker Stripe's setup page returns to: the billing page keeps checking the payment method
 * until the webhook has switched the contract to automatic payment.
 */
export const autoPayReturnParam = {
  key: AUTO_PAY_RETURN_PARAM,
  parser: parseAsBoolean.withDefault(false),
} as const
