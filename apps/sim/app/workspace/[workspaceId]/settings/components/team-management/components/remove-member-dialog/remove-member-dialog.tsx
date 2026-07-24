import { ChipConfirmModal } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { formatQuotedNameList } from '@sim/utils/string'

const MAX_LISTED_CREDENTIALS = 3

interface RemoveMemberDialogProps {
  open: boolean
  memberName: string
  isSelfRemoval?: boolean
  isExternalRemoval?: boolean
  /**
   * Display names of identity-bound credentials (OAuth accounts, personal env
   * keys) the member owns in organization workspaces. These stop working on
   * removal and must be reconnected by a remaining member — disclosed here,
   * never blocking.
   */
  breakingCredentials?: string[]
  isSubmitting?: boolean
  error?: Error | null
  onOpenChange: (open: boolean) => void
  onConfirmRemove: () => Promise<void>
  onCancel: () => void
}

export function RemoveMemberDialog({
  open,
  memberName,
  error,
  onOpenChange,
  onConfirmRemove,
  onCancel,
  isSelfRemoval = false,
  isExternalRemoval = false,
  breakingCredentials = [],
  isSubmitting = false,
}: RemoveMemberDialogProps) {
  const title = isSelfRemoval
    ? 'Leave Organization'
    : isExternalRemoval
      ? 'Remove External Member'
      : 'Remove Team Member'

  const errorMessage = error ? getErrorMessage(error) || null : null

  const credentialWarning =
    breakingCredentials.length > 0
      ? `${breakingCredentials.length === 1 ? 'A credential' : `${breakingCredentials.length} credentials`} ${
          isSelfRemoval ? 'you own' : 'they own'
        } (${formatQuotedNameList(breakingCredentials, MAX_LISTED_CREDENTIALS)}) will stop working in organization workspaces until another member reconnects ${
          breakingCredentials.length === 1 ? 'it' : 'them'
        }.`
      : null

  return (
    <ChipConfirmModal
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
        onOpenChange(next)
      }}
      srTitle={title}
      title={title}
      text={
        isSelfRemoval
          ? 'Are you sure you want to leave this organization? You will lose access to all team resources. This action cannot be undone.'
          : isExternalRemoval
            ? [
                'Are you sure you want to remove ',
                { text: memberName, bold: true },
                ' from all organization workspaces? Their workspace access and workspace credential access will be revoked. This action cannot be undone.',
              ]
            : [
                'Are you sure you want to remove ',
                { text: memberName, bold: true },
                ' from the team? This action cannot be undone.',
              ]
      }
      confirm={{
        label: isSelfRemoval ? 'Leave Organization' : 'Remove',
        onClick: () => onConfirmRemove(),
        pending: isSubmitting,
      }}
    >
      {credentialWarning ? (
        <p className='mt-1 px-2 text-[var(--text-muted)] text-caption'>{credentialWarning}</p>
      ) : null}
      {errorMessage ? (
        <p role='alert' className='mt-1 px-2 text-[var(--text-error)] text-caption'>
          {errorMessage}
        </p>
      ) : null}
    </ChipConfirmModal>
  )
}
