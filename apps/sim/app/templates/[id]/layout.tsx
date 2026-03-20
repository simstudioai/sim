// import { db } from '@sim/db'
// import { permissions, workspace } from '@sim/db/schema'
// import { and, desc, eq } from 'drizzle-orm'
// import { redirect } from 'next/navigation'
// import { getSession } from '@/lib/auth'

// export const dynamic = 'force-dynamic'
// export const revalidate = 0

interface TemplateLayoutProps {
  children: React.ReactNode
}

/**
 * Template detail layout (public scope) — currently disabled.
 * Previously redirected authenticated users to the workspace-scoped template detail.
 */
export default function TemplateDetailLayout({ children }: TemplateLayoutProps) {
  return children
}
