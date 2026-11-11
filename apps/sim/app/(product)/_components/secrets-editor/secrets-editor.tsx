'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { GenericSecrets } from '@/app/(product)/_components/secrets-editor/generic-secrets'
import type { GuardBack } from '@/app/(product)/_components/secrets-editor/secret-rows'
import { WorkspaceSecrets } from '@/app/(product)/_components/secrets-editor/workspace-secrets'
import { DetailHeader } from '@/app/(product)/_components/settings-parts/settings-parts'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { memberSecretMetadata } from '@/platform/lib/integrations/metadata.generated'
import { useSurfaceScope } from '@/platform/lib/surface-scope'

/** Whose secrets the editor holds. */
type SecretsEditorScope =
  | { kind: 'organization' | 'member'; organizationId: string }
  | { kind: 'workspace'; workspaceId: string; onViewDetails: (credentialId: string) => void }

interface SecretsEditorProps {
  scope: SecretsEditorScope
  /**
   * The heading and way back of a page the editor fills on its own, such as a member's Integrations
   * entry. Without one, an organization's secrets lead back to Sources.
   */
  header?: (guardBack: GuardBack) => ReactNode
}

/** An organization's, a member's, or a workspace's and the viewer's own secrets, edited in place. */
export function SecretsEditor({ scope, header }: SecretsEditorProps) {
  if (scope.kind === 'workspace')
    return <WorkspaceSecrets workspaceId={scope.workspaceId} onViewDetails={scope.onViewDetails} />
  return (
    <GenericSecrets
      organizationId={scope.organizationId}
      mode={scope.kind}
      header={
        header ??
        (scope.kind === 'organization'
          ? (guardBack: GuardBack) => <SourcesHeader guardBack={guardBack} />
          : undefined)
      }
    />
  )
}

/** An administrator reads the organization's secrets as a section of Sources. */
function SourcesHeader({ guardBack }: { guardBack: GuardBack }) {
  const router = useRouter()
  const sources = surfaceHref(useSurfaceScope(), '/settings/integrations')
  return (
    <DetailHeader
      backLabel='Sources'
      onBack={() => guardBack(() => router.push(sources))}
      title={memberSecretMetadata.name}
    />
  )
}
