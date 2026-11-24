import { type QueryState, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getOrganizationPaymentMethodContract,
  startOrganizationAutoPayContract,
} from '@/lib/api/contracts/organization'
import { organizationKeys } from '@/hooks/queries/utils/organization-keys'

const ORGANIZATION_PAYMENT_METHOD_STALE_TIME = 60 * 1000
/** How often, and how many times, to re-read while auto-pay waits on Stripe's webhook. */
const AUTO_PAY_CONFIRM_INTERVAL_MS = 2_000
const AUTO_PAY_CONFIRM_ATTEMPTS = 15

async function fetchOrganizationPaymentMethod(orgId: string, signal?: AbortSignal) {
  const response = await requestJson(getOrganizationPaymentMethodContract, {
    params: { id: orgId },
    signal,
  })
  return response.data
}

type PaymentMethodState = QueryState<Awaited<ReturnType<typeof fetchOrganizationPaymentMethod>>>

/** Whether the contract has not switched to auto-pay yet and tries remain, failed reads included. */
function awaitsAutoPay(state: PaymentMethodState | undefined): boolean {
  if (!state) return true
  return (
    state.data?.collectionMethod !== 'charge_automatically' &&
    state.dataUpdateCount + state.errorUpdateCount < AUTO_PAY_CONFIRM_ATTEMPTS
  )
}

/**
 * How a self-serve Enterprise organization pays. `confirmingAutoPay` keeps re-reading after the
 * customer returns from Stripe's setup page, until the webhook has switched the contract to
 * automatic payment or the tries run out; `isConfirmingAutoPay` is true for that window.
 */
export function useOrganizationPaymentMethod(
  orgId: string,
  options: { enabled: boolean; confirmingAutoPay: boolean }
) {
  const queryClient = useQueryClient()
  const queryKey = organizationKeys.paymentMethod(orgId)
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchOrganizationPaymentMethod(orgId, signal),
    enabled: !!orgId && options.enabled,
    staleTime: ORGANIZATION_PAYMENT_METHOD_STALE_TIME,
    refetchInterval: (current) =>
      options.confirmingAutoPay && awaitsAutoPay(current.state)
        ? AUTO_PAY_CONFIRM_INTERVAL_MS
        : false,
  })
  return {
    ...query,
    isConfirmingAutoPay:
      options.confirmingAutoPay &&
      awaitsAutoPay(
        queryClient.getQueryState<Awaited<ReturnType<typeof fetchOrganizationPaymentMethod>>>(
          queryKey
        )
      ),
  }
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
