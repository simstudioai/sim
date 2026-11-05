'use client'

import type { ReactNode } from 'react'
import { RedesignSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import type { ComposerChrome } from '@/app/o/[organizationId]/home/components/composer'
import styles from '@/platform/app/(shell)/home/_components/home-composer-chrome/home-composer-chrome.module.css'
import { IconButton, SegmentedControl } from '@/platform/design-system/components'

const PLAN_OPTIONS = [
  { value: 'build', label: 'Build' },
  { value: 'plan', label: 'Plan' },
] as const

/** A surface holding only design-system controls, so the legacy composer can sit around it. */
function ControlIsland({ children }: { children: ReactNode }) {
  return (
    <div className={styles.island}>
      <RedesignSurface>
        <div className={styles.controls}>{children}</div>
      </RedesignSurface>
    </div>
  )
}

/**
 * The design's composer on Home. The field and the model selector are legacy components, so the
 * frame cannot be a surface: its material comes from a surface painted behind it, and each group of
 * design-system controls sits in a surface of its own beside them.
 */
export const HOME_COMPOSER_CHROME: ComposerChrome = {
  frameClassName: styles.frame,
  fieldClassName: styles.field,
  backdrop: (
    <div className={styles.backdrop} aria-hidden='true'>
      <RedesignSurface>
        <div className={styles.material} data-material='reading' data-elevation='composer' />
      </RedesignSurface>
    </div>
  ),
  renderLeadingControls: ({ addResources, attachFile, skills, plan }) => (
    <ControlIsland>
      {addResources && (
        <IconButton tooltip label={addResources.label} icon='I074' onClick={addResources.onClick} />
      )}
      {attachFile && (
        <IconButton tooltip label={attachFile.label} icon='I117' onClick={attachFile.onClick} />
      )}
      {skills && <IconButton tooltip label={skills.label} icon='I044' onClick={skills.onClick} />}
      {plan && (
        <SegmentedControl
          label='Mode'
          options={PLAN_OPTIONS}
          value={plan.active ? 'plan' : 'build'}
          onSelect={() => plan.onToggle()}
        />
      )}
    </ControlIsland>
  ),
  renderSubmitControl: (action) => (
    <ControlIsland>
      {action.kind === 'stop' ? (
        <IconButton label={action.label} icon='I035' variant='solid' onClick={action.onClick} />
      ) : (
        <IconButton
          label={action.label}
          icon='I023'
          variant='solid'
          disabled={action.disabled}
          onClick={action.onClick}
        />
      )}
    </ControlIsland>
  ),
}
