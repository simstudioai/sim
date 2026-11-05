import { IntegrationsRoute } from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-route'

export default function Page({ searchParams }: PageProps<'/integrations/access'>) {
  return <IntegrationsRoute section='access' searchParams={searchParams} />
}
