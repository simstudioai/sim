'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { workspacePath } from '@/lib/navigation/paths'
import { SecretsEditor } from '@/app/(product)/_components/secrets-editor/secrets-editor'
import type { WorkspaceSettingsSectionProps } from '@/app/(product)/workspace/[workspaceId]/settings/_components/section-registry'
import { SecretDetail } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/secrets/secret-detail'
import { platformHref } from '@/platform/lib/navigation'

/** The workspace's and the viewer's secrets, or one secret's details at `secrets/<credentialId>`. */
export default function SecretsSection({ workspaceId, subpath }: WorkspaceSettingsSectionProps) {
  const router = useRouter()
  const search = useSearchParams()
  const [credentialId] = subpath
  const listHref = platformHref(workspacePath(workspaceId, 'settings/secrets'), search)

  if (credentialId)
    return (
      <SecretDetail
        key={credentialId}
        workspaceId={workspaceId}
        credentialId={credentialId}
        onBack={() => router.push(listHref)}
      />
    )
  return (
    <SecretsEditor
      scope={{
        kind: 'workspace',
        workspaceId,
        onViewDetails: (id) =>
          router.push(
            platformHref(
              workspacePath(workspaceId, `settings/secrets/${encodeURIComponent(id)}`),
              search
            )
          ),
      }}
    />
  )
}
