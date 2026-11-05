'use client'

import { formatQuotedNameList } from '@sim/utils/string'
import styles from '@/platform/app/(shell)/settings/_components/sections/members/members.module.css'
import { Modal } from '@/platform/design-system/components'
import { useMemberRemoval } from '@/platform/lib/data/members'

const MAX_LISTED_CREDENTIALS = 3

export interface RemovalTarget {
  userId: string
  name: string
  isSelf: boolean
  isExternal: boolean
}

interface RemoveMemberModalProps {
  target: RemovalTarget | null
  onClose: () => void
}

function describeImpact(
  isSelf: boolean,
  credentials: readonly string[],
  checkFailed: boolean
): string | null {
  const who = isSelf ? 'you own' : 'they own'
  if (checkFailed)
    return `Couldn't check which credentials ${who} will be affected — connected accounts backed by ${isSelf ? 'your' : 'their'} identity may stop working after removal.`
  if (credentials.length === 0) return null
  const subject = credentials.length === 1 ? 'A credential' : `${credentials.length} credentials`
  const pronoun = credentials.length === 1 ? 'it' : 'them'
  return `${subject} ${who} (${formatQuotedNameList([...credentials], MAX_LISTED_CREDENTIALS)}) will stop working in organization workspaces until another member reconnects ${pronoun}.`
}

/** Removal discloses what stops working first, holding the confirm until that check has answered. */
export function RemoveMemberModal({ target, onClose }: RemoveMemberModalProps) {
  const removal = useMemberRemoval(target)
  const isSelf = target?.isSelf ?? false
  const title = isSelf
    ? 'Leave organization'
    : target?.isExternal
      ? 'Remove external member'
      : 'Remove team member'
  const impact = describeImpact(isSelf, removal.credentials, removal.checkFailed)
  return (
    <Modal
      variant='confirm'
      destructive
      open={target !== null}
      onOpenChange={(open) => !open && onClose()}
      title={title}
      confirmLabel={isSelf ? 'Leave organization' : 'Remove'}
      confirmDisabled={removal.checking}
      onConfirm={removal.confirm}
    >
      <p data-type='T060'>
        {isSelf
          ? 'Are you sure you want to leave this organization? You will lose access to all team resources. This action cannot be undone.'
          : target?.isExternal
            ? `Are you sure you want to remove ${target.name} from all organization workspaces? Their workspace access and workspace credential access will be revoked. This action cannot be undone.`
            : `Are you sure you want to remove ${target?.name} from the team? This action cannot be undone.`}
      </p>
      {removal.checking ? (
        <p className={styles.status} role='status' data-type='T060'>
          Checking which connected credentials this affects…
        </p>
      ) : (
        impact && (
          <p className={styles.status} data-type='T060'>
            {impact}
          </p>
        )
      )}
    </Modal>
  )
}
