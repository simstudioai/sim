'use client'

import { ActivityBody } from '@sim/emcn/activity-row/activity-body'
import { Avatar } from '@sim/emcn/avatar'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { DetailsField } from '@sim/emcn/field/details-field'
import { ListField } from '@sim/emcn/field/list-field'
import { Modal } from '@sim/emcn/modal'
import { FailureNotice, StatusTag } from '@sim/emcn/status'
import styles from '@/app/(product)/_components/pending-invitations/pending-invitations.module.css'
import { type PendingInvitation, usePendingInvitations } from '@/platform/lib/data/invitations'

interface InvitationsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The viewer's pending invitations, each with its disclosure and its own Decline and Accept.
 * Accepting closes the dialog and opens what the invitation joined; declining keeps it open for
 * the rest.
 */
export function InvitationsModal({ open, onOpenChange }: InvitationsModalProps) {
  const invitations = usePendingInvitations(open)

  function renderInvitation(invitation: PendingInvitation) {
    const hasDetails = Boolean(invitation.joinNotice) || invitation.grants.length > 0
    const actions = (
      <div className={styles.actions}>
        <Button
          size='compact'
          disabled={invitations.busy}
          aria-label={`Decline invitation to ${invitation.label}`}
          onClick={() => void invitations.decline(invitation.id)}
        >
          Decline
        </Button>
        <Button
          size='compact'
          variant='primary'
          disabled={invitations.busy || invitation.needsRefresh}
          aria-label={`Accept invitation to ${invitation.label}`}
          onClick={() =>
            void invitations.accept(invitation.id).then((accepted) => {
              if (accepted) onOpenChange(false)
            })
          }
        >
          Accept
        </Button>
      </div>
    )
    return (
      <section
        key={invitation.id}
        className={styles.invitation}
        aria-label={`Invitation to ${invitation.label}`}
      >
        <div className={styles.row}>
          <div className={styles.identity}>
            <ActivityBody
              decorativeLeading
              leading={
                <Avatar
                  name={invitation.workspace?.name ?? invitation.label}
                  src={invitation.workspace?.logo}
                  organization
                />
              }
            >
              <span data-type='T059'>{invitation.label}</span>
              <span className={styles.detail} data-type='T052'>
                {invitation.inviter}
              </span>
            </ActivityBody>
          </div>
          {invitation.workspace && <StatusTag label={invitation.workspace.access} />}
          {!hasDetails && actions}
        </div>
        {invitation.joinNotice && (
          <>
            <DetailsField label='Before you join'>
              <span className={styles.paragraphs}>
                {invitation.joinNotice.paragraphs.map((paragraph) => (
                  <span key={paragraph}>{paragraph}</span>
                ))}
              </span>
            </DetailsField>
            <ListField
              label='Workspaces moving into the organization'
              groups={[{ id: 'moving', items: invitation.joinNotice.moving }]}
            />
            {invitation.needsRefresh && (
              <div className={styles.actions}>
                <Button
                  size='compact'
                  disabled={invitations.busy || invitations.fetching}
                  onClick={invitations.retry}
                >
                  Refresh invitation
                </Button>
              </div>
            )}
          </>
        )}
        <ListField label='Workspace access' groups={[{ id: 'grants', items: invitation.grants }]} />
        {hasDetails && actions}
      </section>
    )
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title='Invitations'
      accessibleName='Pending invitations'
      cancelLabel='Done'
      pending={invitations.busy}
    >
      {invitations.status === 'error' ? (
        <FailureNotice
          title='Unable to load invitations'
          message={invitations.error?.message ?? 'Could not load invitations'}
          retrying={invitations.fetching}
          onRetry={invitations.retry}
        />
      ) : invitations.status === 'success' && invitations.rows.length === 0 ? (
        <EmptyState title='No pending invitations' />
      ) : (
        <div className={styles.list}>{invitations.rows.map(renderInvitation)}</div>
      )}
    </Modal>
  )
}
