'use client'

import { Modal, RecipientField } from '@/platform/design-system/components'

interface InviteModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function InviteModal({ open, onOpenChange }: InviteModalProps) {
  return (
    <Modal
      title='Invite people'
      open={open}
      onOpenChange={onOpenChange}
      confirmLabel='Invite'
      confirmDisabled
    >
      <RecipientField label='Email addresses' name='recipients' placeholder='name@company.com' />
    </Modal>
  )
}
