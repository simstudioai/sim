import styles from '#auth/components/navigation/navigation.module.css'

interface AuthNavPromptProps {
  prompt?: string
  href: string
  linkLabel: string
  onNavigate?: () => void
}
/** Links between Auth routes with full-document navigation; the host preserves return context. */
export function AuthNavPrompt({ prompt, href, linkLabel, onNavigate }: AuthNavPromptProps) {
  return (
    <div className={styles.navPrompt}>
      {prompt && <span>{prompt}</span>}
      <a href={href} onClick={onNavigate}>
        {linkLabel}
      </a>
    </div>
  )
}
