import { PROVIDER_ICONS } from '@/components/icons/providers'
import { IntegrationMark } from '@/platform/embedded/app/(shell)/integrations/_components/integration-mark/integration-mark'

interface ProviderMarkProps {
  providerId: string
}

/** A model provider's mark, by the `providerId` the server resolves. */
export function ProviderMark({ providerId }: ProviderMarkProps) {
  return <IntegrationMark providerId={providerId} icon={PROVIDER_ICONS[providerId]} />
}
