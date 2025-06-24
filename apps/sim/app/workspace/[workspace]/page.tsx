import { redirect } from 'next/navigation'

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspace: string }>
}) {
  const workspace = (await params).workspace
  redirect(`/workspace/${workspace}/w`)
}
