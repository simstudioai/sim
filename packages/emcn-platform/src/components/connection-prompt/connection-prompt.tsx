import { Button } from '@sim/emcn/button'
import { ControlRow } from '@sim/emcn/button/control-row'
import type { IconName } from '@sim/emcn/catalog/icon-geometry'
import Link from 'next/link'
import styles from '#platform/components/connection-prompt/connection-prompt.module.css'

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
