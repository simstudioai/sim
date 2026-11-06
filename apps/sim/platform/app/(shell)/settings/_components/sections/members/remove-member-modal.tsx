'use client'

import { formatQuotedNameList } from '@sim/utils/string'
import styles from '@/platform/app/(shell)/settings/_components/sections/members/members.module.css'
import { ConfirmDialog } from '@/platform/design-system/components'
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

function removalCopy(target: RemovalTarget | null) {
  if (target?.isSelf)
    return {
      title: 'Leave organization',
      confirmLabel: 'Leave organization',
      body: 'Are you sure you want to leave this organization? You will lose access to all team resources. This action cannot be undone.',
    }
  if (target?.isExternal)
    return {
      title: 'Remove external member',
      confirmLabel: 'Remove',
      body: `Are you sure you want to remove ${target.name} from all organization workspaces? Their workspace access and workspace credential access will be revoked. This action cannot be undone.`,
    }
  return {
    title: 'Remove team member',
    confirmLabel: 'Remove',
    body: `Are you sure you want to remove ${target?.name} from the team? This action cannot be undone.`,
  }
}

/** Removal discloses what stops working first, holding the confirm until that check has answered. */
export function RemoveMemberModal({ target, onClose }: RemoveMemberModalProps) {
  const removal = useMemberRemoval(target)
  const copy = removalCopy(target)
  const impact = describeImpact(target?.isSelf ?? false, removal.credentials, removal.checkFailed)
  return (
    <ConfirmDialog
      target={target !== null}
      onClose={onClose}
      title={copy.title}
      confirmLabel={copy.confirmLabel}
      pendingLabel={target?.isSelf ? 'Leaving…' : 'Removing…'}
      confirmDisabled={removal.checking}
      onConfirm={removal.confirm}
    >
      <p data-type='T060'>{copy.body}</p>
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
    </ConfirmDialog>
  )
}
