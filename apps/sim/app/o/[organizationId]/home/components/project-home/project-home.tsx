'use client'

import { OrganizationHome } from '@/app/o/[organizationId]/home/organization-home'

interface ProjectHomeProps {
  userName?: string
}

/** Home and saved chats use the same organization-owned conversation surface. */
export function ProjectHome({ userName }: ProjectHomeProps) {
  return <OrganizationHome userName={userName} />
}
