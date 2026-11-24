'use client'

import { Chip, OverflowText, toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryState } from 'nuqs'
import { AUTO_PAY_RETURN_PARAM } from '@/lib/api/contracts/organization'
import { autoPayReturnParam } from '@/app/workspace/[workspaceId]/settings/components/billing/search-params'
import {
  useOrganizationPaymentMethod,
  useStartOrganizationAutoPay,
} from '@/hooks/queries/organization-payment-method'

const logger = createLogger('EnterprisePaymentMethodRow')

interface EnterprisePaymentMethodRowProps {
  organizationId: string
  canManage: boolean
}

/**
 * How a self-serve Enterprise contract pays. Saving a card or US bank account on Stripe's page
 * switches renewals, seat true-ups, and overage from emailed invoices to automatic payment; on
 * the way back the row keeps checking until Stripe's webhook has made the switch.
 */
export function EnterprisePaymentMethodRow({
  organizationId,
  canManage,
}: EnterprisePaymentMethodRowProps) {
  const [returnedFromSetup] = useQueryState(autoPayReturnParam.key, autoPayReturnParam.parser)
  const { data, isPending, isFetching, isError } = useOrganizationPaymentMethod(organizationId, {
    enabled: canManage,
    confirmingAutoPay: returnedFromSetup,
  })
  const startAutoPay = useStartOrganizationAutoPay()

  const autoPay = data?.collectionMethod === 'charge_automatically'

  const describe = () => {
    if (!canManage) return 'Managed by organization admins'
    if (isError) return 'Unavailable'
    if (isPending) return '—'
    if (autoPay) return `Auto-pay · ${data?.paymentMethod?.label ?? 'payment method on file'}`
    if (returnedFromSetup && isFetching) return 'Confirming payment method…'
    return 'Paid by invoice'
  }

  const handleSetUp = () => {
    const returnUrl = new URL(window.location.href)
    returnUrl.searchParams.delete(AUTO_PAY_RETURN_PARAM)
    startAutoPay.mutate(
      { organizationId, returnUrl: returnUrl.toString() },
      {
        onSuccess: ({ url }) => {
          window.location.href = url
        },
        onError: (error) => {
          logger.error('Failed to start auto-pay setup', { error })
          toast.error("Couldn't open payment setup", {
            description: getErrorMessage(error, 'Please try again in a moment.'),
          })
        },
      }
    )
  }

  return (
    <div className='flex items-center justify-between gap-3'>
      <div className='flex min-w-0 flex-col'>
        <span className='text-[var(--text-body)] text-small'>Payment method</span>
        <OverflowText label={describe()} className='text-[var(--text-muted)] text-caption' />
      </div>
      <Chip
        disabled={!canManage || isPending || isError || startAutoPay.isPending}
        onClick={handleSetUp}
      >
        {autoPay ? 'Update' : 'Set up auto-pay'}
      </Chip>
    </div>
  )
}
