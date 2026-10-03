'use client'

import { Chip, cn } from '@sim/emcn'
import { ArrowRight } from '@sim/emcn/icons'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

interface SettingsUpgradeNoticeProps {
  /** Names the gated surface, e.g. `Sandboxes require an active Max plan`. */
  title: string
  /** One sentence on what the plan unlocks. */
  description: string
  /**
   * Whether to offer the upgrade action. Members who cannot act on it are shown
   * the reason without a button that would only dead-end them.
   */
  canUpgrade?: boolean
  /**
   * Tightens the vertical rhythm for a modal, where the full-height centering a
   * settings page wants would leave the dialog mostly empty.
   */
  compact?: boolean
}

/**
 * Canonical wall for a surface gated behind the Max plan. Owns the copy rhythm
 * and the route to upgrade, so every gated section reads and behaves the same.
 *
 * The action lands on billing, which redirects a member who cannot manage
 * billing to the plan-comparison page instead — so it is never a dead end.
 */
export function SettingsUpgradeNotice({
  title,
  description,
  canUpgrade = false,
  compact = false,
}: SettingsUpgradeNoticeProps) {
  const { navigateToSettings } = useSettingsNavigation()

  return (
    <div
      className={cn('flex flex-col items-center justify-center gap-4', compact ? 'py-10' : 'py-20')}
    >
      <div className='text-center'>
        <h3 className='text-[var(--text-primary)] text-md'>{title}</h3>
        <p className='mt-1.5 text-[var(--text-muted)] text-sm'>{description}</p>
      </div>
      {canUpgrade && (
        <Chip
          variant='primary'
          rightIcon={ArrowRight}
          onClick={() => navigateToSettings({ section: 'billing' })}
        >
          Upgrade to Max
        </Chip>
      )}
    </div>
  )
}
