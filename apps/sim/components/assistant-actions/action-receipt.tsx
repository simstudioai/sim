import { useState } from 'react'
import { Chip, cn, OverflowText } from '@sim/emcn'
import { ChevronDown, ChevronRight, ShieldCheck } from '@sim/emcn/icons'
import { ActionPreview } from '@/components/assistant-actions/action-preview'
import { assistantActionPresentation } from '@/components/assistant-actions/presentation'
import type { AssistantActionReceiptsResponse } from '@/lib/api/contracts/assistant-actions'
import { resolveCredentialDisplay } from '@/lib/integrations/credential-display'
import { InteractionCard } from '@/app/workspace/[workspaceId]/home/components/message-content/components/interaction-card'
import { BrandIcon } from '@/blocks/brand-icon'

type ActionReceipt = AssistantActionReceiptsResponse['receipts'][number]

const STATE_LABELS: Record<ActionReceipt['state'], string> = {
  pending: 'Waiting for review',
  approved: 'Approved',
  running: 'Running',
  succeeded: 'Completed',
  cancelled: 'Cancelled',
  failed: 'Failed',
  uncertain: 'Outcome unknown',
}

interface AssistantActionReceiptProps {
  receipt: ActionReceipt
}

/** Durable execution state and the exact approved fields, independent of transcript tool status. */
export function AssistantActionReceipt({ receipt }: AssistantActionReceiptProps) {
  const [expanded, setExpanded] = useState(false)
  const presentation = assistantActionPresentation(receipt)
  const display = receipt.account
    ? resolveCredentialDisplay({ ...receipt.account, type: 'managed_oauth' })
    : undefined
  return (
    <section aria-label={`${presentation.title} receipt`} className='min-w-0'>
      <InteractionCard
        title={
          <span className='flex min-w-0 items-center gap-2'>
            {display?.icon ? (
              <BrandIcon icon={display.icon} className='size-[14px] shrink-0' />
            ) : (
              <ShieldCheck className='size-[14px] shrink-0 text-[var(--text-icon)]' />
            )}
            <span className='min-w-0 break-words'>{presentation.title}</span>
          </span>
        }
        actions={
          <Chip
            aria-label={`${expanded ? 'Hide' : 'View'} ${presentation.title} receipt`}
            aria-expanded={expanded}
            rightIcon={expanded ? ChevronDown : ChevronRight}
            onClick={() => setExpanded(!expanded)}
          >
            {STATE_LABELS[receipt.state]}
          </Chip>
        }
      >
        <div className='flex min-w-0 flex-col gap-2 px-2 pb-2'>
          {!expanded && presentation.primary[0] && (
            <OverflowText
              label={presentation.primary[0].value}
              className='text-[var(--text-muted)] text-small'
            />
          )}
          {receipt.state === 'uncertain' && (
            <p className='text-[var(--text-error)] text-small'>Check the app before retrying.</p>
          )}
          {receipt.warning && (
            <p
              className={cn(
                'whitespace-pre-wrap break-words text-[var(--text-muted)] text-small',
                !expanded && 'line-clamp-2'
              )}
            >
              {receipt.warning}
            </p>
          )}
          {expanded && (
            <>
              <p className='break-words text-[var(--text-muted)] text-small'>
                {receipt.account?.displayName ?? 'Account unavailable'}
              </p>
              {receipt.detailsAvailable ? (
                <ActionPreview action={receipt} full />
              ) : (
                <p className='text-[var(--text-muted)] text-small'>
                  Details are no longer available for this action.
                </p>
              )}
            </>
          )}
        </div>
      </InteractionCard>
    </section>
  )
}
