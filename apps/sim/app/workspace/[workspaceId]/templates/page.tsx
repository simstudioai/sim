import { notFound } from 'next/navigation'

// import { db } from '@sim/db'
// import { settings, templateCreators, templateStars, templates, user } from '@sim/db/schema'
// import { and, desc, eq, sql } from 'drizzle-orm'
// import type { Metadata } from 'next'
// import { redirect } from 'next/navigation'
// import { getSession } from '@/lib/auth'
// import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'
// import type { Template as WorkspaceTemplate } from '@/app/workspace/[workspaceId]/templates/templates'
// import Templates from '@/app/workspace/[workspaceId]/templates/templates'
// import { getUserPermissionConfig } from '@/ee/access-control/utils/permission-check'

// export const metadata: Metadata = {
//   title: 'Templates',
// }

// interface TemplatesPageProps {
//   params: Promise<{
//     workspaceId: string
//   }>
// }

/**
 * Workspace-scoped Templates page — currently disabled, returns 404.
 */
export default function TemplatesPage() {
  notFound()
}
