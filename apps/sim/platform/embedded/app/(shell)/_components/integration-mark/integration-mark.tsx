import type { ComponentType } from 'react'
import { Icon } from '@sim/emcn/icon'
import { providerMark } from '@sim/emcn/icon/provider-marks'
import styles from '@/platform/embedded/app/(shell)/_components/integration-mark/integration-mark.module.css'

const GENERIC_MARK = 'I070'

interface IntegrationMarkProps {
  providerId?: string
  /** The app's brand icon, for a provider the design system has no mark for. */
  icon?: ComponentType<{ className?: string }>
}

export function IntegrationMark({ providerId, icon: BrandIcon }: IntegrationMarkProps) {
  if (providerId && providerMark(providerId) !== GENERIC_MARK)
    return <Icon providerId={providerId} />
  if (!BrandIcon) return <Icon name={GENERIC_MARK} />
  return (
    <span className={styles.mark}>
      <BrandIcon />
    </span>
  )
}
