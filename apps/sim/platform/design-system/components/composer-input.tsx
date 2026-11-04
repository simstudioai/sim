import styles from '@/platform/design-system/components/components.module.css'

interface ComposerInputProps {
  label: string
  placeholder?: string
  defaultValue?: string
  density?: 'standard' | 'compact'
}

export function ComposerInput({
  label,
  placeholder,
  defaultValue,
  density = 'standard',
}: ComposerInputProps) {
  return (
    <textarea
      aria-label={label}
      className={styles.composerInput}
      data-density={density}
      data-type='T048'
      data-type-light={density === 'compact' ? 'T094' : undefined}
      rows={1}
      placeholder={placeholder}
      defaultValue={defaultValue}
    />
  )
}
