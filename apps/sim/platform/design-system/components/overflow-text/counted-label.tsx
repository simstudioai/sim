import { OverflowText } from '@/platform/design-system/components/overflow-text/overflow-text'
import styles from '@/platform/design-system/components/overflow-text/overflow-text.module.css'

interface CountedLabelProps {
  label: string
  count?: number
}

export function CountedLabel({ label, count }: CountedLabelProps) {
  if (count === undefined) return <OverflowText text={label}>{label}</OverflowText>
  return (
    <OverflowText text={`${label} ${count}`}>
      <span className={styles.counted}>
        <span>{label}</span>
        <small data-type='T036'>{count}</small>
      </span>
    </OverflowText>
  )
}
