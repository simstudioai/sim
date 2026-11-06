import styles from '@/platform/app/(shell)/integrations/_components/credential-list/credential-list.module.css'
import { IntegrationUsage } from '@/platform/app/(shell)/integrations/_components/integration-usage/integration-usage'
import { ActionMenu, ActivityRow } from '@/platform/design-system/components'
import { CountedLabel } from '@/platform/design-system/components/overflow-text/counted-label'
import { credentialDescription } from '@/platform/lib/integrations/credential-display'
import type { IntegrationCredential } from '@/platform/lib/integrations/credential-model'

interface CredentialListProps {
  integrationName: string
  credentials: readonly IntegrationCredential[]
  onOpen: (credential: IntegrationCredential) => void
  onReconnect: (credential: IntegrationCredential) => void
  onDisconnect: (credential: IntegrationCredential) => void
  canReconnect: (credential: IntegrationCredential) => boolean
}

export function CredentialList({
  integrationName,
  credentials,
  onOpen,
  onReconnect,
  onDisconnect,
  canReconnect,
}: CredentialListProps) {
  return (
    <section className={styles.section} aria-label='Connected credentials'>
      <h2 data-type='T093'>
        <CountedLabel label='Connected credentials' count={credentials.length} />
      </h2>
      {credentials.length > 0 ? (
        <ul className={styles.list}>
          {credentials.map((credential) => (
            <ActivityRow
              key={credential.id}
              title={credential.displayName}
              detail={credentialDescription(credential, integrationName)}
              onOpen={() => onOpen(credential)}
              metadata={
                <IntegrationUsage
                  people={credential.members.filter((member) => member.status === 'active')}
                  label='People with access'
                />
              }
              trailing={
                credential.role === 'admin' && credential.scope.kind !== 'organization-managed' ? (
                  <ActionMenu
                    label={`Manage ${credential.displayName}`}
                    icon='I108'
                    triggerSize='row'
                    tooltip={false}
                    align='end'
                    actions={[
                      {
                        id: 'details',
                        label: 'Edit details and access',
                        onSelect: () => onOpen(credential),
                      },
                      ...(canReconnect(credential)
                        ? [
                            {
                              id: 'reconnect',
                              label: 'Reconnect',
                              onSelect: () => onReconnect(credential),
                            },
                          ]
                        : []),
                      {
                        id: 'disconnect',
                        label: 'Disconnect',
                        destructive: true,
                        separatorBefore: true,
                        onSelect: () => onDisconnect(credential),
                      },
                    ]}
                  />
                ) : undefined
              }
            />
          ))}
        </ul>
      ) : (
        <p className={styles.empty} data-type='T060'>
          No connected credentials
        </p>
      )}
    </section>
  )
}
