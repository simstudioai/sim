'use client'

import { useState } from 'react'
import { toast } from '@sim/emcn'
import { RequestText } from '@/platform/app/(shell)/settings/_components/sections/requests/request-text'
import styles from '@/platform/app/(shell)/settings/_components/sections/requests/requests.module.css'
import {
  Button,
  Disclosure,
  FailureNotice,
  InlineNotice,
  Modal,
  PropertyList,
  TextAreaField,
  TextField,
} from '@/platform/design-system/components'
import { useRequestReview } from '@/platform/lib/data/requests'

interface ReviewModalProps {
  organizationId: string
  requestId: string
  onClose: () => void
}

/**
 * Reviews one request. Apply sends the fingerprint of this preview, and a failed apply refreshes
 * the preview, so an admin never approves a policy they did not just read.
 */
export function ReviewModal({ organizationId, requestId, onClose }: ReviewModalProps) {
  const review = useRequestReview(organizationId, requestId)
  const [declining, setDeclining] = useState(false)
  const [decisionReason, setDecisionReason] = useState('')
  const [newLimit, setNewLimit] = useState('')
  const { model } = review
  const parsedLimit = Number(newLimit)
  const canApply =
    Boolean(model?.canApply) && (!model?.usageLimit || review.isValidLimit(parsedLimit))
  const pending = Boolean(model?.pending)
  const label = !pending
    ? 'Done'
    : declining
      ? 'Decline request'
      : model?.usageLimit
        ? 'Increase limit'
        : model?.alreadyAvailable
          ? 'Mark fulfilled'
          : 'Apply group change'
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={model?.title ?? 'Review access request'}
      cancelLabel='Close'
      submitOnEnter={false}
      confirmLabel={label}
      destructive={pending && declining}
      confirmDisabled={
        pending && (review.fetching || (declining ? !decisionReason.trim() : !canApply))
      }
      onConfirm={
        pending
          ? async () => {
              toast.success(
                declining
                  ? await review.decline(decisionReason)
                  : await review.apply(model?.usageLimit ? parsedLimit : null)
              )
            }
          : undefined
      }
    >
      {review.loading && (
        <p role='status' data-type='T060'>
          Loading preview…
        </p>
      )}
      {review.loadError && (
        <FailureNotice
          title='Unable to load preview'
          message={review.loadError.message}
          onRetry={review.retry}
        />
      )}
      {model && (
        <>
          <RequestText label='Requested by'>
            {model.requesterName
              ? `${model.requesterName} · ${model.requesterEmail}`
              : model.requesterEmail}
          </RequestText>
          {model.reason && <RequestText label='Reason'>{model.reason}</RequestText>}
          {model.decided && model.permission && (
            <>
              {model.changes.length > 0 && (
                <RequestText label='Permission group'>{model.groupName}</RequestText>
              )}
              {pending && model.alreadyAvailable && (
                <RequestText label='Current access'>This access is already available.</RequestText>
              )}
              {model.changes.length > 0 && (
                <>
                  <ul className={styles.changes}>
                    {model.changes.map((change) => (
                      <li key={change.key} data-type='T060'>
                        <span className={styles.changeLabel}>{change.label}: </span>
                        {change.summary}
                      </li>
                    ))}
                  </ul>
                  <Disclosure label='Change details'>
                    <div className={styles.changeDetails}>
                      {model.workspaces && (
                        <RequestText label='Workspaces'>{model.workspaces}</RequestText>
                      )}
                      {model.changes.map((change) => (
                        <PropertyList
                          key={change.key}
                          title={change.label}
                          properties={[
                            { id: 'before', label: 'Before', kind: 'text', value: change.before },
                            { id: 'after', label: 'After', kind: 'text', value: change.after },
                          ]}
                        />
                      ))}
                    </div>
                  </Disclosure>
                </>
              )}
            </>
          )}
          {model.decided && model.usageLimit && (
            <>
              <RequestText
                label={
                  model.fulfilled ? 'Previous member credit limit' : 'Current member credit limit'
                }
              >
                {model.currentLimit ?? 'No member limit'}
              </RequestText>
              {model.fulfilled && model.newLimit !== null && (
                <RequestText label='New member credit limit'>{model.newLimit}</RequestText>
              )}
              {pending && !declining && (
                <TextField
                  label='New member credit limit'
                  inputMode='numeric'
                  value={newLimit}
                  onChange={setNewLimit}
                  hint='Enter a whole number above the current limit.'
                />
              )}
            </>
          )}
          {pending && model.unavailableReason && (
            <InlineNotice intent='warning' message={model.unavailableReason} />
          )}
          {model.decision && <RequestText label='Decision'>{model.decision}</RequestText>}
          {pending && declining && (
            <TextAreaField
              label='Reason for declining'
              required
              maxLength={1000}
              value={decisionReason}
              onChange={setDecisionReason}
            />
          )}
          {pending && (
            <div>
              <Button variant='quiet' size='compact' onClick={() => setDeclining(!declining)}>
                {declining ? 'Back to approval' : 'Decline instead'}
              </Button>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
