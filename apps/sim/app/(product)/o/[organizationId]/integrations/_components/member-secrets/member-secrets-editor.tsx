'use client'

import { useRouter } from 'next/navigation'
import { DirectoryBack } from '@/app/(product)/_components/resource-directory/resource-directory'
import { SecretsEditor } from '@/app/(product)/_components/secrets-editor/secrets-editor'
import { IntegrationsPage } from '@/app/(product)/o/[organizationId]/integrations/_components/integrations-page/integrations-page'
import { ProviderHeading } from '@/app/(product)/o/[organizationId]/integrations/_components/provider-heading/provider-heading'
import { memberSecretMetadata } from '@/platform/lib/integrations/metadata.generated'

interface MemberSecretsEditorProps {
  organizationId: string
  /** The Integrations list the member came from, with its search kept. */
  backHref: string
}

/** A member's own Generic Secrets, read as one more integration's page. */
export function MemberSecretsEditor({ organizationId, backHref }: MemberSecretsEditorProps) {
  const router = useRouter()
  return (
    <IntegrationsPage>
      <SecretsEditor
        scope={{ kind: 'member', organizationId }}
        header={(guardBack) => (
          <>
            <DirectoryBack
              href={backHref}
              label='Integrations'
              onNavigate={(event) => {
                event.preventDefault()
                guardBack(() => router.push(backHref))
              }}
            />
            <ProviderHeading
              name={memberSecretMetadata.name}
              description={memberSecretMetadata.description}
            />
          </>
        )}
      />
    </IntegrationsPage>
  )
}
