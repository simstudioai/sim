import { useId } from 'react'
import { IconButton } from '@/platform/design-system/components/button/button'
import { FieldFrame } from '@/platform/design-system/components/field/fields'
import { Icon } from '@/platform/design-system/components/icon/icon'
import { ScrollArea } from '@/platform/design-system/components/scroll-area/scroll-area'
import styles from '@/platform/design-system/components/workspace-fields/workspace-fields.module.css'

interface LogoUploadFieldProps {
  label: string
  optional?: boolean
}

export function LogoUploadField({ label, optional }: LogoUploadFieldProps) {
  const id = useId()
  return (
    <FieldFrame id={id} label={label} optional={optional}>
      <div className={styles.upload} data-type='T052'>
        <Icon name='I117' />
        Upload
        <input id={id} type='file' accept='image/*' className={styles.uploadInput} />
      </div>
    </FieldFrame>
  )
}

interface RecipientTagProps {
  address: string
  invalid?: boolean
  selected?: boolean
  onRemove?: (address: string) => void
}

export function RecipientTag({ address, invalid, selected, onRemove }: RecipientTagProps) {
  return (
    <span
      className={styles.recipient}
      data-invalid={invalid || undefined}
      data-selected={selected || undefined}
      data-type='T060'
    >
      <span className={styles.address}>{address}</span>
      {onRemove && (
        <span className={styles.removeRecipient}>
          <IconButton
            size='compact'
            label={`Remove ${address}`}
            icon='I105'
            onClick={() => onRemove(address)}
          />
        </span>
      )}
    </span>
  )
}

interface RecipientFieldProps {
  label: string
  recipients: ReadonlyArray<{ address: string; invalid?: boolean }>
  onRemove?: (address: string) => void
  selectedAddress?: string
  error?: string
  placeholder?: string
}

export function RecipientField({
  label,
  recipients,
  onRemove,
  selectedAddress,
  error,
  placeholder,
}: RecipientFieldProps) {
  const id = useId()
  return (
    <FieldFrame id={id} label={label} error={error}>
      <div className={styles.recipients} data-invalid={error ? true : undefined}>
        <ScrollArea label={label}>
          <div className={styles.recipientViewport}>
            {recipients.map((recipient) => (
              <RecipientTag
                key={recipient.address}
                address={recipient.address}
                invalid={recipient.invalid}
                selected={recipient.address === selectedAddress}
                onRemove={onRemove}
              />
            ))}
            <input
              id={id}
              type='email'
              multiple
              data-type='T043'
              placeholder={placeholder}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
            />
          </div>
        </ScrollArea>
      </div>
    </FieldFrame>
  )
}
