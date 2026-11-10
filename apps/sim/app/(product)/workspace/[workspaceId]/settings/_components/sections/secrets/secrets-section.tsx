'use client'

import { useRouter } from 'next/navigation'
import { workspacePath } from '@/lib/navigation/paths'
import { SecretsEditor } from '@/app/(product)/_components/secrets-editor/secrets-editor'
import type { WorkspaceSettingsSectionProps } from '@/app/(product)/workspace/[workspaceId]/settings/_components/section-registry'
import { SecretDetail } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/secrets/secret-detail'
import { usePlatformHref } from '@/platform/lib/navigation'

/** The workspace's and the viewer's secrets, or one secret's details at `secrets/<credentialId>`. */
export default function SecretsSection({ workspaceId, subpath }: WorkspaceSettingsSectionProps) {
  const router = useRouter()
  const hrefFor = usePlatformHref()
  const [credentialId] = subpath
  const listHref = hrefFor(workspacePath(workspaceId, 'settings/secrets'))

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
            hrefFor(workspacePath(workspaceId, `settings/secrets/${encodeURIComponent(id)}`))
          ),
      }}
    />
  )
}
