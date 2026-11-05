import { IntegrationsRoute } from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-route'

export default async function Page({
  params,
  searchParams,
}: PageProps<'/integrations/[providerId]'>) {
  return <IntegrationsRoute section={(await params).providerId} searchParams={searchParams} />
}
