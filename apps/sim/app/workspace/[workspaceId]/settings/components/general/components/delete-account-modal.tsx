'use client'

import { useState } from 'react'
import { ChipConfirmModal, ChipModalError, ChipModalField } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { formatQuotedNameList, normalizeEmail } from '@sim/utils/string'
import { signOut } from '@/lib/auth/auth-client'
import { useAccountDeletionPlan, useDeleteAccount } from '@/hooks/queries/account-deletion'
import { clearUserData } from '@/stores'

const logger = createLogger('DeleteAccountModal')

/** Matches the naming used in the server's blocker sentences. */
const MAX_NAMES_LISTED = 3

/** How long the post-deletion sign-out and store cleanup may take before the redirect goes anyway. */
const SIGN_OUT_TIMEOUT_MS = 3000

interface DeleteAccountModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The signed-in account's email, which must be retyped to confirm. */
  email: string
}

function names(workspaces: { name: string }[]): string {
  return formatQuotedNameList(
    workspaces.map((workspace) => workspace.name),
    MAX_NAMES_LISTED
  )
}

/**
 * Confirms and performs account deletion.
 *
 * The dialog is deliberately explicit rather than alarming: it names every
 * workspace that goes, every workspace that changes hands, and — when the account
 * cannot be deleted yet — exactly what has to happen first. Retyping the account's
 * own email address is the only guard, which is the point: the decision should
 * cost a deliberate action, not a hunt for the right button.
 */
export function DeleteAccountModal({ open, onOpenChange, email }: DeleteAccountModalProps) {
  const [confirmEmail, setConfirmEmail] = useState('')
  const { data: plan, isFetching: isPlanFetching, error: planError } = useAccountDeletionPlan(open)
  const deleteAccount = useDeleteAccount()

  const blockers = plan?.blockers ?? []
  const toDelete = plan?.workspacesToDelete ?? []
  const toTransfer = plan?.workspacesToTransfer ?? []
  const isBlocked = blockers.length > 0
  const isConfirmed = normalizeEmail(confirmEmail) === normalizeEmail(email)
  const isPending = deleteAccount.isPending

  const close = () => {
    onOpenChange(false)
    setConfirmEmail('')
    deleteAccount.reset()
  }

  const handleDelete = () => {
    deleteAccount.mutate(
      { confirmEmail },
      {
        onSuccess: async () => {
          /**
           * The session row is already gone, so signing out can only fail by
           * telling us so — what matters is that its cookie is dropped and no
           * cached client state survives the redirect. The race bounds that
           * cleanup: the account is deleted either way, so a request left hanging
           * must not strand the user on "Deleting..." forever. The redirect is a
           * full document load, which discards anything the cleanup missed.
           */
          await Promise.race([
            Promise.allSettled([signOut(), clearUserData()]),
            sleep(SIGN_OUT_TIMEOUT_MS),
          ])
          window.location.href = '/login?fromLogout=true'
        },
        onError: (error) => {
          logger.error('Account deletion failed', { error })
        },
      }
    )
  }

  const errorMessage =
    deleteAccount.error?.message ??
    (planError ? 'Could not check whether this account can be deleted. Try again.' : null)

  return (
    <ChipConfirmModal
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      size='md'
      title='Delete account'
      confirm={{
        label: 'Delete account',
        pendingLabel: 'Deleting...',
        onClick: handleDelete,
        pending: isPending,
        disabled: isBlocked || isPlanFetching || !isConfirmed || !plan,
        disabledTooltip: isBlocked
          ? 'Resolve the items above first'
          : isConfirmed
            ? undefined
            : 'Enter your account email to confirm',
      }}
    >
      {isBlocked ? (
        <div className='flex flex-col gap-2 px-2'>
          <p className='text-[var(--text-primary)] text-sm'>Your account can’t be deleted yet:</p>
          <ul className='flex list-disc flex-col gap-1 pl-4'>
            {blockers.map((blocker) => (
              <li key={blocker.code} className='text-[var(--text-secondary)] text-sm'>
                {blocker.message}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className='flex flex-col gap-2 px-2'>
          <p className='text-[var(--text-primary)] text-sm'>
            This permanently deletes <span className='font-medium'>{email}</span> along with its
            workflows, chats, files, knowledge bases and credentials.{' '}
            <span className='text-[var(--text-error)]'>This cannot be undone.</span>
          </p>
          {toDelete.length > 0 && (
            <p className='text-[var(--text-secondary)] text-sm'>
              {toDelete.length === 1 ? 'The workspace ' : 'The workspaces '}
              <span className='text-[var(--text-primary)]'>{names(toDelete)}</span> and everything
              in {toDelete.length === 1 ? 'it' : 'them'} will be deleted.
            </p>
          )}
          {toTransfer.length > 0 && (
            <p className='text-[var(--text-secondary)] text-sm'>
              Billing for <span className='text-[var(--text-primary)]'>{names(toTransfer)}</span>{' '}
              moves to another admin. Nothing in {toTransfer.length === 1 ? 'it' : 'them'} changes.
            </p>
          )}
        </div>
      )}
      {!isBlocked && (
        <ChipModalField
          type='email'
          title='Confirm your email'
          value={confirmEmail}
          onChange={setConfirmEmail}
          placeholder={email}
          autoComplete='off'
          disabled={isPending || isPlanFetching}
          required
        />
      )}
      <ChipModalError>{errorMessage}</ChipModalError>
    </ChipConfirmModal>
  )
}
