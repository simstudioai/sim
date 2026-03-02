'use client'

import { useTranslations } from 'next-intl'
import {
  Button,
  Checkbox,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'

interface RemoveMemberDialogProps {
  open: boolean
  memberName: string
  shouldReduceSeats: boolean
  isSelfRemoval?: boolean
  error?: Error | null
  onOpenChange: (open: boolean) => void
  onShouldReduceSeatsChange: (shouldReduce: boolean) => void
  onConfirmRemove: (shouldReduceSeats: boolean) => Promise<void>
  onCancel: () => void
}

export function RemoveMemberDialog({
  open,
  memberName,
  shouldReduceSeats,
  error,
  onOpenChange,
  onShouldReduceSeatsChange,
  onConfirmRemove,
  onCancel,
  isSelfRemoval = false,
}: RemoveMemberDialogProps) {
  const t = useTranslations()

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size='sm'>
        <ModalHeader>
          {isSelfRemoval
            ? t('settings.remove_member.leave_organization')
            : t('settings.remove_member.remove_team_member')}
        </ModalHeader>
        <ModalBody>
          <p className='text-[12px] text-[var(--text-secondary)]'>
            {isSelfRemoval
              ? t('settings.remove_member.confirm_leave')
              : t.rich('settings.remove_member.confirm_remove', {
                  name: memberName,
                  bold: (chunks) => (
                    <span className='font-medium text-[var(--text-primary)]'>{chunks}</span>
                  ),
                })}{' '}
            <span className='text-[var(--text-error)]'>
              {t('settings.remove_member.cannot_undo')}
            </span>
          </p>

          {!isSelfRemoval && (
            <div className='mt-[16px]'>
              <div className='flex items-center gap-[8px]'>
                <Checkbox
                  id='reduce-seats'
                  checked={shouldReduceSeats}
                  onCheckedChange={(checked) => onShouldReduceSeatsChange(checked === true)}
                />
                <label htmlFor='reduce-seats' className='text-[12px] text-[var(--text-primary)]'>
                  {t('settings.remove_member.labels.reduce_seats')}
                </label>
              </div>
              <p className='mt-[4px] text-[12px] text-[var(--text-muted)]'>
                {t('settings.remove_member.reduce_seats_description')}
              </p>
            </div>
          )}

          {error && (
            <div className='mt-[8px]'>
              <p className='text-[12px] text-[var(--text-error)] leading-tight'>
                {error instanceof Error && error.message ? error.message : String(error)}
              </p>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant='default' onClick={onCancel}>
            {t('settings.remove_member.buttons.cancel')}
          </Button>
          <Button variant='destructive' onClick={() => onConfirmRemove(shouldReduceSeats)}>
            {isSelfRemoval
              ? t('settings.remove_member.buttons.leave')
              : t('settings.remove_member.buttons.remove')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
