import { OverflowText } from '@sim/emcn/overflow-text'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/metadata-fields/metadata-fields.module.css'

interface MetadataFieldsProps {
  label: string
  fields: readonly { id: string; label: string; value: string }[]
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
              <OverflowText text={field.value}>{field.value}</OverflowText>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
