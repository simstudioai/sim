import type { ComponentType } from 'react'
import { Icon } from '@/platform/design-system/components/icon/icon'
import { providerMark } from '@/platform/design-system/components/icon/provider-marks'
import styles from '@/platform/embedded/app/(shell)/integrations/_components/integration-mark/integration-mark.module.css'

const GENERIC_MARK = 'I070'

interface IntegrationMarkProps {
  providerId?: string
  /** The app's brand icon, for a provider the design system has no mark for. */
  icon?: ComponentType<{ className?: string }>
}

export function IntegrationMark({ providerId, icon: BrandIcon }: IntegrationMarkProps) {
  if (providerId && providerMark(providerId) !== GENERIC_MARK)
    return <Icon providerId={providerId} />
  return BrandIcon ? <BrandIcon className={styles.mark} /> : <Icon name={GENERIC_MARK} />
}
