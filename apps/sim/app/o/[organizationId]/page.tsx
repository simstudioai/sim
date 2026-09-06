import { redirect } from 'next/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'

export default async function OrganizationPage({
  params,
}: {
  params: Promise<{ organizationId: string }>
}) {
  const { organizationId } = await params
  redirect(organizationRoutes(organizationId).home)
}
