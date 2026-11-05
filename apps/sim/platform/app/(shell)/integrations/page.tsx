import { IntegrationsRoute } from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-route'

export default function Page({ searchParams }: PageProps<'/integrations'>) {
  return <IntegrationsRoute searchParams={searchParams} />
}
