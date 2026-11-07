import { OverflowText } from '#emcn/components/overflow-text/overflow-text'
import styles from '#emcn/components/overflow-text/overflow-text.module.css'

interface CountedLabelProps {
  label: string
  count?: number
}

export function CountedLabel({ label, count }: CountedLabelProps) {
  if (count === undefined) return <OverflowText text={label}>{label}</OverflowText>
  return (
    <OverflowText text={`${label} ${count}`}>
      {label} <span className={styles.count}>{count}</span>
    </OverflowText>
  )
}
