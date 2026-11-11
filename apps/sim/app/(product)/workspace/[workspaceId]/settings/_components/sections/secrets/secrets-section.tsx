'use client'

import { SecretsEditor } from '@/app/(product)/_components/secrets-editor/secrets-editor'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import { SectionStack } from '@/app/(product)/_components/settings-parts/settings-parts'
import type { WorkspaceSettingsSectionProps } from '@/app/(product)/workspace/[workspaceId]/settings/_components/section-registry'
import { SECRET_ID_PARAM } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/secrets/search-params'
import { SecretDetail } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/secrets/secret-detail'
import { useSettingsSubview } from '@/platform/lib/data/settings-subview'

/**
 * The workspace's and the viewer's secrets, or one secret's detail. The detail reads its secret by
 * id on its own and answers a dead id itself, so it opens without waiting on the list.
 */
export default function SecretsSection({ workspaceId }: WorkspaceSettingsSectionProps) {
  const subview = useSettingsSubview({ idParam: SECRET_ID_PARAM })

  if (subview.id)
    return (
      <SecretDetail
        key={subview.id}
        workspaceId={workspaceId}
        credentialId={subview.id}
        onBack={subview.close}
      />
    )
  return (
    <SectionStack>
      <SettingsPageHeader />
      <SecretsEditor scope={{ kind: 'workspace', workspaceId, onViewDetails: subview.open }} />
    </SectionStack>
  )
}
