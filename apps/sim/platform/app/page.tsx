import { redirect } from 'next/navigation'
import { platformHref } from '@/platform/design-system/navigation'

export default async function Page({ searchParams }: PageProps<'/'>) {
  const query = await searchParams
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') search.set(key, value)
  }
  if (search.has('recipe')) redirect(`/workbench?${search}`)
  redirect(platformHref('/home', search))
}
