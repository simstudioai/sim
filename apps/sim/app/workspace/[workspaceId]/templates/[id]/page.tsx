import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'
import TemplateDetails from '@/app/templates/[id]/template'

interface TemplatePageProps {
  params: Promise<{
    workspaceId: string
    id: string
  }>
}

/**
 * Workspace-scoped template detail page.
 * Requires authentication and workspace membership to access.
 * Uses the shared TemplateDetails component with workspace context.
 */
export default async function TemplatePage({ params }: TemplatePageProps) {
  const { workspaceId } = await params
  const session = await getSession()

  // Require authentication
  if (!session?.user?.id) {
    redirect('/login')
  }

  // Verify workspace membership
  const hasPermission = await verifyWorkspaceMembership(session.user.id, workspaceId)
  if (!hasPermission) {
    redirect('/')
  }

  return <TemplateDetails isWorkspaceContext={true} />
}
