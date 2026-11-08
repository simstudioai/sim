import styles from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/metadata-fields/metadata-fields.module.css'

interface MetadataFieldsProps {
  label: string
  fields: readonly { id: string; label: string; value: string }[]
}

/** Paper's metadata fields: a caption over its value, each at its own width, wrapping as space runs out. */
export function MetadataFields({ label, fields }: MetadataFieldsProps) {
  return (
    <dl className={styles.fields} aria-label={label}>
      {fields.map((field) => (
        <div key={field.id} className={styles.field}>
          <dt data-type='T050'>{field.label}</dt>
          <dd data-type='T060'>{field.value}</dd>
        </div>
      ))}
    </dl>
  )
}
