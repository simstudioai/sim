import styles from '#auth/components/divider/divider.module.css'

interface AuthDividerProps {
  label?: string
}
/** Separates alternate actions; an omitted label leaves only the divider line. */
export function AuthDivider({ label }: AuthDividerProps) {
  return <div className={styles.divider}>{label && <span>{label}</span>}</div>
}
