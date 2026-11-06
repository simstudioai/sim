'use client'

import {
  Chip,
  ChipButtonGroup,
  ChipButtonGroupItem,
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import { Check, Link, Send } from '@sim/emcn/icons'
import { GeneratedPasswordInput } from '@/components/ui'
import type { ShareAuthType } from '@/lib/api/contracts/public-shares'
import { SimLinkChip } from '@/app/o/[organizationId]/links/sim-link-shortcut'
import {
  type ShareDialogProps,
  useShareDialog,
} from '@/app/workspace/[workspaceId]/files/components/share-modal/use-share-dialog'

export function ShareModal(props: ShareDialogProps) {
  const { open, fileName } = props
  const dialog = useShareDialog(props)
  const { saved } = dialog
  return (
    <>
      <ChipModal
        open={open}
        onOpenChange={dialog.close}
        size='sm'
        srTitle={`Share ${fileName}`}
        dismissDisabled={dialog.pending}
      >
        <ChipModalHeader icon={Send} onClose={dialog.close}>
          Share file
        </ChipModalHeader>
        <ChipModalBody>
          <ChipModalField type='custom' title='Access' hint={dialog.accessHint}>
            <ChipButtonGroup
              value={dialog.mode}
              onValueChange={(value) => dialog.setMode(value as ShareAuthType)}
              aria-label='File access'
              disabled={dialog.pending}
            >
              {dialog.accessModes.map(({ value, label }) => (
                <ChipButtonGroupItem key={value} value={value}>
                  {label}
                </ChipButtonGroupItem>
              ))}
            </ChipButtonGroup>
          </ChipModalField>
          {dialog.mode === 'password' ? (
            <ChipModalField
              type='custom'
              title='Password'
              hint={
                saved?.hasPassword
                  ? 'Leave blank to keep the current password.'
                  : 'Anyone with the link must enter this password.'
              }
            >
              <GeneratedPasswordInput
                value={dialog.password}
                onChange={dialog.setPassword}
                placeholder={saved?.hasPassword ? '••••••••' : 'Enter a password'}
                disabled={dialog.pending}
              />
            </ChipModalField>
          ) : null}
          {dialog.mode === 'email' || dialog.mode === 'sso' ? (
            <ChipModalField
              type='emails'
              title='Allowed emails'
              value={dialog.emails}
              onChange={dialog.setEmails}
              validate={dialog.validateEmail}
              allowDomains
              placeholder='Enter emails or domains'
              placeholderWithTags='Add email or domain'
              disabled={dialog.pending}
            />
          ) : null}
        </ChipModalBody>
        <ChipModalFooter
          onCancel={dialog.close}
          defaultAction={dialog.isUnshareAction ? 'none' : 'primary'}
          secondaryActions={
            saved?.isActive && saved.url
              ? [
                  {
                    custom: (
                      <Chip
                        leftIcon={dialog.copied ? Check : Link}
                        onClick={() => dialog.copy(saved.url)}
                      >
                        {dialog.copied ? 'Copied!' : 'Copy link'}
                      </Chip>
                    ),
                  },
                  {
                    custom: (
                      <SimLinkChip url={saved.url} title={fileName.replace(/\.[^.]+$/, '')} />
                    ),
                  },
                ]
              : undefined
          }
          primaryAction={{
            label: dialog.primaryLabel,
            onClick: dialog.runPrimaryAction,
            variant: dialog.isUnshareAction ? 'destructive' : 'primary',
            disabled: dialog.primaryDisabled,
          }}
        />
      </ChipModal>
      <ChipConfirmModal
        open={open && dialog.unshareConfirmOpen}
        onOpenChange={dialog.setUnshareConfirmOpen}
        title='Unshare file?'
        text='Are you sure you want to unshare this file? Anyone with the link will lose access.'
        confirm={{
          label: 'Unshare',
          onClick: dialog.confirmUnshare,
          pending: dialog.pending,
          pendingLabel: 'Unsharing...',
        }}
      />
    </>
  )
}
