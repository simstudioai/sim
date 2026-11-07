import Link from 'next/link'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import { Button } from '@/platform/design-system/components/button/button'
import { ControlRow } from '@/platform/design-system/components/button/control-row'
import styles from '@/platform/design-system/components/connection-prompt/connection-prompt.module.css'

interface ConnectionPromptProps {
  title: string
  setupGuideUrl?: string
  options: readonly {
    label: string
    icon: IconName | { providerId: string }
    onConnect?: () => void
  }[]
}

export function ConnectionPrompt({ title, options, setupGuideUrl }: ConnectionPromptProps) {
  return (
    <div className={styles.prompt} data-material='shell'>
      <p data-type='T060'>{title}</p>
      <div className={styles.providers}>
        {setupGuideUrl && (
          <ControlRow
            render={<Link href={setupGuideUrl} target='_blank' rel='noopener noreferrer' />}
            icon='I082'
            label='Docs'
            accessibleLabel='Docs (opens in a new tab)'
          />
        )}
        {options.map(({ label, icon, onConnect }) => (
          <Button key={label} icon={icon} onClick={onConnect} disabled={!onConnect}>
            {label}
          </Button>
        ))}
      </div>
    </div>
  )
}
