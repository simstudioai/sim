import styles from '@/platform/app/(shell)/people/_components/directory-sync/directory-sync.module.css'
import { Icon } from '@/platform/design-system/components'
import { SYNC_SOURCE_NAMES, type SyncSource } from '@/platform/lib/data/people'

export const SOURCE_MARKS: Record<SyncSource, string> = { okta: 'O', entra: 'E', scim: 'S' }

const SOURCES = [
  { source: 'okta', hint: 'Sync your Okta directory' },
  { source: 'entra', hint: 'Sync your Entra directory' },
  { source: 'scim', hint: 'Use existing provisioning' },
] as const

interface DirectorySourcesProps {
  canProvision: boolean
  onConnect: (source: SyncSource) => void
}

/** The directories an organization can connect, shared by first use and the sync page. */
export function DirectorySources({ canProvision, onConnect }: DirectorySourcesProps) {
  return (
    <div className={styles.sources}>
      {SOURCES.filter(({ source }) => source !== 'scim' || canProvision).map(({ source, hint }) => (
        <button
          key={source}
          type='button'
          className={styles.source}
          aria-label={`Connect ${SYNC_SOURCE_NAMES[source]}`}
          onClick={() => onConnect(source)}
        >
          <span className={styles.mark} aria-hidden='true' data-type='T042'>
            {SOURCE_MARKS[source]}
          </span>
          <span className={styles.sourceCopy}>
            <span data-type='T042'>{source === 'scim' ? 'SCIM' : SYNC_SOURCE_NAMES[source]}</span>
            <span className={styles.secondary} data-type='T050'>
              {hint}
            </span>
          </span>
          <span className={styles.sourceAction} data-type='T043'>
            Connect
            <Icon name='I032' />
          </span>
        </button>
      ))}
    </div>
  )
}

interface ImportPromptProps {
  onImport: () => void
}

export function ImportPrompt({ onImport }: ImportPromptProps) {
  return (
    <p className={styles.importPrompt} data-type='T043'>
      Need a one-time update?
      <button type='button' className={styles.importLink} onClick={onImport}>
        Import profiles
      </button>
    </p>
  )
}
