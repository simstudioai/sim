'use client'

import { useSearchParams } from 'next/navigation'
import { useOrganizationIntegrations } from '@/platform/app/(shell)/_components/session/integration-changes'
import { IntegrationDetails } from '@/platform/app/(shell)/integrations/_components/integration-details/integration-details'
import { IntegrationList } from '@/platform/app/(shell)/integrations/_components/integration-list/integration-list'
import styles from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-page.module.css'
import { MemberSecrets } from '@/platform/app/(shell)/integrations/_components/member-secrets/member-secrets'
import { Chip, Icon } from '@/platform/design-system/components'
import { type IntegrationsData, memberIntegrationHref } from '@/platform/lib/integrations/model'

interface IntegrationsPageProps {
  data: IntegrationsData | null
  section?: string
}

export function IntegrationsPage({ data, section }: IntegrationsPageProps) {
  const search = useSearchParams()
  const { integrations, save } = useOrganizationIntegrations(data)
  const item = integrations.find((entry) => entry.providerId === section)
  const secrets = section === 'secrets' ? data?.genericSecrets : null
  return (
    <main className={styles.page}>
      {item || secrets ? (
        <>
          <nav aria-label='Integration navigation' className={styles.back}>
            <Chip href={memberIntegrationHref('/integrations', search)} icon='I093'>
              Integrations
            </Chip>
          </nav>
          <header className={styles.providerHeading}>
            <span className={styles.mark}>
              {item ? <Icon providerId={item.providerId} /> : <Icon name='I070' />}
            </span>
            <div className={styles.heading}>
              <h1 data-type='T076'>{item?.name ?? 'Generic Secrets'}</h1>
              {item && <p data-type='T048'>{item.description}</p>}
            </div>
          </header>
          {item && <IntegrationDetails key={item.providerId} integration={item} onChange={save} />}
          {secrets && <MemberSecrets source={secrets} />}
        </>
      ) : (
        <>
          <header className={styles.heading}>
            <h1 data-type='T076'>Integrations</h1>
            <p data-type='T048'>
              Connect your accounts to the apps your organization makes available.
            </p>
          </header>
          <IntegrationList integrations={integrations} secrets={data?.genericSecrets ?? null} />
        </>
      )}
    </main>
  )
}
