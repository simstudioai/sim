import { env } from '@/lib/env'
import { Switch } from './switch'

interface E2BSwitchProps {
  blockId: string
  subBlockId: string
  title: string
  value?: boolean
  isPreview?: boolean
  previewValue?: boolean | null
  disabled?: boolean
}

export function E2BSwitch(props: E2BSwitchProps) {
  const e2bEnabled = env.NEXT_PUBLIC_E2B_ENABLED === 'true'

  if (!e2bEnabled) {
    return null
  }

  return <Switch {...props} />
}
