import { useMutation, useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getOrganizationPaymentMethodContract,
  startOrganizationAutoPayContract,
} from '@/lib/api/contracts/organization'
import { organizationKeys } from '@/hooks/queries/utils/organization-keys'

const ORGANIZATION_PAYMENT_METHOD_STALE_TIME = 60 * 1000

async function fetchOrganizationPaymentMethod(orgId: string, signal?: AbortSignal) {
  const response = await requestJson(getOrganizationPaymentMethodContract, {
    params: { id: orgId },
    signal,
  })
  return response.data
}
/** How often, and how many times, to re-read while auto-pay waits on Stripe's webhook. */
const AUTO_PAY_CONFIRM_INTERVAL_MS = 2_000
const AUTO_PAY_CONFIRM_ATTEMPTS = 15

/**
 * How a self-serve Enterprise organization pays. `confirmingAutoPay` keeps re-reading after the
 * customer returns from Stripe's setup page, until the webhook has switched the contract to
 * automatic payment.
 */
export function useOrganizationPaymentMethod(
  orgId: string,
  options: { enabled: boolean; confirmingAutoPay: boolean }
) {
  return useQuery({
    queryKey: organizationKeys.paymentMethod(orgId),
    queryFn: ({ signal }) => fetchOrganizationPaymentMethod(orgId, signal),
    enabled: !!orgId && options.enabled,
    staleTime: ORGANIZATION_PAYMENT_METHOD_STALE_TIME,
    refetchInterval: (query) =>
      options.confirmingAutoPay &&
      query.state.data?.collectionMethod !== 'charge_automatically' &&
      query.state.dataUpdateCount < AUTO_PAY_CONFIRM_ATTEMPTS
        ? AUTO_PAY_CONFIRM_INTERVAL_MS
        : false,
  })
}

/** Opens Stripe's setup page that saves a payment method and turns on auto-pay. */
export function useStartOrganizationAutoPay() {
  return useMutation({
    mutationFn: ({ organizationId, returnUrl }: { organizationId: string; returnUrl: string }) =>
      requestJson(startOrganizationAutoPayContract, {
        params: { id: organizationId },
        body: { returnUrl },
      }),
  })
}
