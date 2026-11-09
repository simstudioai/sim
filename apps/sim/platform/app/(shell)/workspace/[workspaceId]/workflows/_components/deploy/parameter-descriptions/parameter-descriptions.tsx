import { FieldFrame, TextField } from '@sim/emcn/field'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/parameter-descriptions/parameter-descriptions.module.css'

interface ParameterDescriptionsProps {
  /** The Start block's inputs, each described in its own field. */
  fields: readonly { name: string; type?: string }[]
  value: (name: string) => string
  placeholder: (name: string) => string
  onChange: (name: string, value: string) => void
  hint?: string
}

/** A described parameter per Start input, as the API info and the MCP tool both ask for. */
export function ParameterDescriptions({
  fields,
  value,
  placeholder,
  onChange,
  hint,
}: ParameterDescriptionsProps) {
  if (fields.length === 0) return null
  return (
    <FieldFrame label='Parameters' count={fields.length} hint={hint}>
      <div className={styles.fields}>
        {fields.map((field) => (
          <TextField
            key={field.name}
            label={`${field.name} · ${field.type || 'string'}`}
            placeholder={placeholder(field.name)}
            value={value(field.name)}
            onChange={(next) => onChange(field.name, next)}
            autoComplete='off'
          />
        ))}
      </div>
    </FieldFrame>
  )
}
