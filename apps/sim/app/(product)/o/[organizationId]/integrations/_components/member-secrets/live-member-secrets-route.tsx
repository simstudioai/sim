import { notFound, redirect } from 'next/navigation'
import { MemberSecretsEditor } from '@/app/(product)/o/[organizationId]/integrations/_components/member-secrets/member-secrets-editor'
import {
  integrationsListHref,
  readGenericSecretSourceMode,
} from '@/platform/lib/data/generic-secrets-source'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { readOrganizationSurface } from '@/platform/lib/data/surface'
import { hasMemberIntegrations } from '@/platform/lib/data/member-integrations'

interface LiveMemberSecretsRouteProps {
  searchParams: Record<string, string | string[] | undefined>
}

/** A member's own Generic Secrets, open only while the organization keeps them per member. */
export async function LiveMemberSecretsRoute({ searchParams }: LiveMemberSecretsRouteProps) {
  const surface = await readOrganizationSurface()
  // The layout already rendered this outcome's login, denial or error state.
  if (surface.status !== 'ok') return null
  const { organization } = surface
  // Member-scoped accounts are Enterprise's; other organizations have no such page.
  if (!hasMemberIntegrations(organization)) notFound()
  if ((await readGenericSecretSourceMode(organization.organization.id)) !== 'member')
    redirect(surfaceHref(organization, '/integrations'))
  return (
    <MemberSecretsEditor
      organizationId={organization.organization.id}
      backHref={integrationsListHref(organization, searchParams)}
    />
  )
}
