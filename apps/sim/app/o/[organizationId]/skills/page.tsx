import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'

export const metadata: Metadata = {
  title: 'Skills',
}

interface OrganizationSkillsPageProps {
  params: Promise<{ organizationId: string }>
}

export default async function OrganizationSkillsPage({ params }: OrganizationSkillsPageProps) {
  const { organizationId } = await params
  redirect(organizationRoutes(organizationId).home)
}
