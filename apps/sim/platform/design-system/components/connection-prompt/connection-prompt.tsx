import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import { Button } from '@/platform/design-system/components/button/button'
import styles from '@/platform/design-system/components/connection-prompt/connection-prompt.module.css'

interface ConnectionPromptProps {
  title: string
  options: readonly {
    label: string
    icon: IconName | { providerId: string }
    onConnect?: () => void
  }[]
}

export function ConnectionPrompt({ title, options }: ConnectionPromptProps) {
  return (
    <div className={styles.prompt} data-material='shell'>
      <p data-type='T060'>{title}</p>
      <div className={styles.providers}>
        {options.map(({ label, icon, onConnect }) => (
          <Button key={label} icon={icon} onClick={onConnect} disabled={!onConnect}>
            {label}
          </Button>
        ))}
      </div>
    </div>
  )
}
