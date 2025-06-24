import { redirect } from 'next/navigation'

interface WorkspacePageProps {
  params: {
    workspace: string
  }
}

export default function WorkspacePage({ params }: WorkspacePageProps) {
  redirect(`/workspace/${params.workspace}/w`)
}
