import { redirect } from 'next/navigation'
import { memberIntegrationHref } from '@/platform/lib/integrations/fixture-model'

export default async function Page({
  searchParams,
}: PageProps<'/workspace/[workspaceId]/integrations/[[...detail]]'>) {
  const search = await searchParams
  redirect(
    memberIntegrationHref('/integrations', {
      get: (key) => (typeof search[key] === 'string' ? search[key] : null),
    })
  )
}
