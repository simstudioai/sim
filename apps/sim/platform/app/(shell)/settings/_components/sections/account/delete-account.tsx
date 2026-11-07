'use client'

import { useState } from 'react'
import { TextField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { InlineNotice } from '@sim/emcn/status'
import styles from '@/platform/app/(shell)/settings/_components/sections/account/account-section.module.css'
import { useAccountDeletion } from '@/platform/lib/data/account'

interface DeleteAccountProps {
  email: string
  legacyOrigin: string
  fixture?: true
  onClose: () => void
}

/**
 * Names every workspace that goes, every workspace that changes hands, and, when the account cannot
 * be deleted yet, what has to happen first. Retyping the account's email is the only guard.
 */
export function DeleteAccount({ email, legacyOrigin, fixture, onClose }: DeleteAccountProps) {
  const deletion = useAccountDeletion(email, legacyOrigin)
  const [confirmation, setConfirmation] = useState('')
  const blocked = deletion.blockers.length > 0
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      destructive
      title='Delete account'
      confirmLabel='Delete account'
      confirmDisabled={
        blocked || deletion.fetching || !deletion.loaded || !deletion.matches(confirmation)
      }
      onConfirm={() => (fixture ? onClose() : deletion.confirm(confirmation))}
    >
      {blocked ? (
        <div className={styles.copy}>
          <p data-type='T067'>Your account can’t be deleted yet:</p>
          <ul className={styles.blockers}>
            {deletion.blockers.map((blocker) => (
              <li key={blocker.code} data-type='T067'>
                {blocker.message}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <div className={styles.copy}>
            <p data-type='T067'>
              This permanently deletes {email} along with its workflows, chats, files, knowledge
              bases and credentials. This cannot be undone.
            </p>
            {deletion.deletedCount > 0 && (
              <p data-type='T067'>
                {deletion.deletedCount === 1 ? 'The workspace ' : 'The workspaces '}
                {deletion.deletedNames} and everything in{' '}
                {deletion.deletedCount === 1 ? 'it' : 'them'} will be deleted.
              </p>
            )}
            {deletion.transferredCount > 0 && (
              <p data-type='T067'>
                Billing for {deletion.transferredNames} moves to another admin. Nothing in{' '}
                {deletion.transferredCount === 1 ? 'it' : 'them'} changes.
              </p>
            )}
          </div>
          <TextField
            type='email'
            label='Confirm your email'
            placeholder={email}
            autoComplete='off'
            disabled={deletion.fetching}
            value={confirmation}
            onChange={setConfirmation}
          />
        </>
      )}
      {deletion.planError && <InlineNotice intent='danger' message={deletion.planError} />}
    </Modal>
  )
}
