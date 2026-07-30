'use client'

import { Chip, ChipModal, ChipModalBody, ChipModalFooter, ChipModalHeader } from '@sim/emcn'
import type {
  BYOKManagerKey,
  BYOKManagerProvider,
} from '@/app/workspace/[workspaceId]/settings/components/byok/byok-key-manager'

interface BYOKProviderKeysModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Provider whose keys are being managed; null while closed. */
  provider: BYOKManagerProvider | null
  keys: BYOKManagerKey[]
  /** Maximum keys allowed per provider; disables adding once reached. */
  maxKeys: number
  readOnly?: boolean
  onAddKey: () => void
  onUpdateKey: (key: BYOKManagerKey) => void
  onDeleteKey: (key: BYOKManagerKey) => void
}

/**
 * Lists every stored key for one provider with per-key update/delete actions.
 * Requests round-robin across the listed keys; the footer's primary action
 * adds another key until {@link BYOKProviderKeysModalProps.maxKeys} is
 * reached.
 */
export function BYOKProviderKeysModal({
  open,
  onOpenChange,
  provider,
  keys,
  maxKeys,
  readOnly = false,
  onAddKey,
  onUpdateKey,
  onDeleteKey,
}: BYOKProviderKeysModalProps) {
  const close = () => onOpenChange(false)
  const atCapacity = keys.length >= maxKeys

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Manage API Keys'>
      <ChipModalHeader onClose={close}>{provider && `${provider.name} API Keys`}</ChipModalHeader>
      <ChipModalBody>
        <p className='px-2 text-[var(--text-secondary)] text-sm'>
          Requests are distributed evenly across these keys. Your keys are encrypted and stored
          securely.
        </p>
        <div className='flex flex-col gap-2 px-2'>
          {keys.map((key) => (
            <div key={key.id} className='flex items-center justify-between gap-2.5'>
              <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                <span className='truncate text-[var(--text-body)] text-sm'>
                  {key.name ?? 'Unnamed key'}
                </span>
                <span className='truncate font-mono text-[var(--text-muted)] text-caption'>
                  {key.maskedKey}
                </span>
              </div>
              {!readOnly && (
                <div className='flex flex-shrink-0 items-center gap-2'>
                  <Chip onClick={() => onUpdateKey(key)}>Update</Chip>
                  <Chip onClick={() => onDeleteKey(key)}>Delete</Chip>
                </div>
              )}
            </div>
          ))}
        </div>
        {atCapacity && (
          <p className='px-2 text-[var(--text-muted)] text-caption'>
            Key limit reached ({maxKeys} keys per provider).
          </p>
        )}
      </ChipModalBody>
      <ChipModalFooter
        onCancel={close}
        hideCancel={readOnly}
        primaryAction={
          readOnly
            ? { label: 'Close', onClick: close }
            : {
                label: 'Add Key',
                onClick: onAddKey,
                disabled: atCapacity,
              }
        }
      />
    </ChipModal>
  )
}
