import { CopyButton } from '@sim/emcn/button/copy-button'
import { OverflowText } from '@sim/emcn/overflow-text'
import styles from '@/app/(product)/workspace/[workspaceId]/_components/metadata-fields/metadata-fields.module.css'

export interface MetadataField {
  id: string
  label: string
  value: string
  /** Opens the value's record in a new tab. */
  href?: string
  /** Offers to copy the value, as an id is copied. */
  copyable?: boolean
}

interface MetadataFieldsProps {
  label: string
  fields: readonly MetadataField[]
}

/**
 * Paper's metadata fields: a caption over a one-line value, in columns shared by every row. A value
 * wider than its column fades and shows in full on hover, as Paper's single-line clamp does.
 */
export function MetadataFields({ label, fields }: MetadataFieldsProps) {
  return (
    <section aria-label={label}>
      <dl className={styles.fields}>
        {fields.map((field) => (
          <div key={field.id} className={styles.field}>
            <dt data-type='T050'>{field.label}</dt>
            <dd data-type='T060'>
              {field.href ? (
                <a
                  className={styles.link}
                  href={field.href}
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  <OverflowText text={field.value}>{field.value}</OverflowText>
                </a>
              ) : (
                <OverflowText text={field.value}>{field.value}</OverflowText>
              )}
              {field.copyable && (
                <span className={styles.action}>
                  <CopyButton
                    label={`Copy ${field.label.toLowerCase()}`}
                    text={field.value}
                    size='compact'
                  />
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
