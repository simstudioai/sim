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
}: InputProps) {
  return (
    <input
      id={id}
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

interface TextAreaProps extends InputProps {
  density?: 'regular' | 'expanded'
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
  density = 'regular',
}: TextAreaProps) {
  return (
    <textarea
      id={id}
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
