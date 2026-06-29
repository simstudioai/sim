'use client'

import { useTranslations } from 'next-intl'
import { Chip, ChipModal, ChipModalBody, ChipModalFooter, ChipModalHeader } from '@/components/emcn'
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
  onAddKey,
  onUpdateKey,
  onDeleteKey,
}: BYOKProviderKeysModalProps) {
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
  const close = () => onOpenChange(false)
  const atCapacity = keys.length >= maxKeys

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle={tI18n('manage_api_keys')}>
      <ChipModalHeader onClose={close}>{provider && `${provider.name} API Keys`}</ChipModalHeader>
      <ChipModalBody>
        <p className='px-2 text-[var(--text-secondary)] text-sm'>
          {t('requests_are_distributed_evenly_across_these')}
        </p>
        <div className='flex flex-col gap-2 px-2'>
          {keys.map((key) => (
            <div key={key.id} className='flex items-center justify-between gap-2.5'>
              <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                <span className='truncate text-[14px] text-[var(--text-body)]'>
                  {key.name ?? tI18n('unnamed_key')}
                </span>
                <span className='truncate font-mono text-[12px] text-[var(--text-muted)]'>
                  {key.maskedKey}
                </span>
              </div>
              <div className='flex flex-shrink-0 items-center gap-2'>
                <Chip onClick={() => onUpdateKey(key)}>{t('update')}</Chip>
                <Chip onClick={() => onDeleteKey(key)}>{t('delete')}</Chip>
              </div>
            </div>
          ))}
        </div>
        {atCapacity && (
          <p className='px-2 text-[12px] text-[var(--text-muted)]'>
            {t('key_limit_reached')}
            {maxKeys} {t('keys_per_provider')}
          </p>
        )}
      </ChipModalBody>
      <ChipModalFooter
        onCancel={close}
        primaryAction={{
          label: 'Add Key',
          onClick: onAddKey,
          disabled: atCapacity,
        }}
      />
    </ChipModal>
  )
}
