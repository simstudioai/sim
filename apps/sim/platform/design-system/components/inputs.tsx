import styles from '@/platform/design-system/components/components.module.css'

export interface ControlProps {
  id?: string
  label: string
  name?: string
  defaultValue?: string
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
}

interface InputProps extends ControlProps {
  required?: boolean
  pattern?: string
  placeholder?: string
}

export function Input({
  id,
  label,
  name,
  defaultValue,
  disabled,
  invalid,
  describedBy,
  placeholder,
  required,
  pattern,
}: InputProps) {
  return (
    <input
      id={id}
      required={required}
      pattern={pattern}
      aria-label={label}
      className={styles.input}
      data-type='T043'
      name={name}
      defaultValue={defaultValue}
      placeholder={placeholder}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    />
  )
}

interface TextAreaProps extends Omit<InputProps, 'pattern'> {
  density?: 'expanded'
}

export function TextArea({
  id,
  label,
  name,
  defaultValue,
  disabled,
  invalid,
  describedBy,
  placeholder,
  density,
  required,
}: TextAreaProps) {
  return (
    <textarea
      id={id}
      required={required}
      aria-label={label}
      className={styles.input}
      data-type='T043'
      name={name}
      data-density={density}
      defaultValue={defaultValue}
      placeholder={placeholder}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    />
  )
}
