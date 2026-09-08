import type { ComponentType } from 'react'
import { cn } from '@sim/emcn'
import {
  HOME_INSET,
  HOME_TYPE,
  LANDING_CONTENT_WIDTH,
  LANDING_GUTTER,
} from '@/app/(landing)/components/landing-layout'
import type { SecurityMarkProps } from '@/app/(landing)/components/security/icons'
import {
  AuditRecordsMark,
  DataRetentionMark,
  PermissionGroupsMark,
  SelfHostingMark,
  SpendControlsMark,
  SsoMark,
} from '@/app/(landing)/components/security/icons'

/**
 * Everything under the title — the mark and the description — drops to the
 * page's lightest text tier, so each cell reads title first and the outline
 * mark never competes with it.
 */
const CONTROL_QUIET = 'text-[var(--text-secondary)]'

/**
 * The feature rail's caption measure (15px/1.45), so a control reads as the
 * same kind of copy as the card captions directly above it. Not in
 * {@link HOME_TYPE}, whose scale steps 14 → 16 straight past the caption size
 * the rail and the lifecycle grid both set by hand.
 */
const CONTROL_COPY = 'text-[15px] leading-[1.45]'

/**
 * The rail and controls share a group in `Landing`. Its positive gap provides
 * breathing room above this inset rule; the padding balances the space below.
 */
const CONTROL_RULE = 'border-[var(--border)] border-t pt-16 max-sm:pt-12 max-lg:pt-14'

interface Control {
  title: string
  description: string
  Mark: ComponentType<SecurityMarkProps>
}

const CONTROLS: readonly Control[] = [
  {
    title: 'SSO & SCIM',
    description: 'Connect your identity provider for sign-in and automatic member provisioning.',
    Mark: SsoMark,
  },
  {
    title: 'Permission groups',
    description: 'Control which models, integrations, and tools each group can use.',
    Mark: PermissionGroupsMark,
  },
  {
    title: 'Spend controls',
    description: 'Set organization and per-member usage limits, with cost tracked by workspace.',
    Mark: SpendControlsMark,
  },
  {
    title: 'Audit records',
    description: 'Sim records security-relevant changes and traces every run.',
    Mark: AuditRecordsMark,
  },
  {
    title: 'Data retention',
    description: 'Sim lets each workspace set how long run data is kept.',
    Mark: DataRetentionMark,
  },
  {
    title: 'Self-hosting',
    description: 'Run Sim in your own cloud with Docker or Kubernetes.',
    Mark: SelfHostingMark,
  },
] as const

/**
 * Operational controls as a heading-less white spec grid on the page measure,
 * six items over two even rows. It reads as the plain-language index of the
 * feature rail it follows, so it carries no title of its own: the section is
 * named by `aria-label`, and the items stay `h3` under the rail's `h2` rather
 * than becoming six competing section headings. Certifications and the
 * governance intro live in `Security`, a separate beat further down the page.
 */
export function WorkspaceControls() {
  return (
    <section
      id='controls'
      aria-label='Workspace controls'
      className={cn('flex w-full flex-col', LANDING_CONTENT_WIDTH, LANDING_GUTTER)}
    >
      <div className={cn(HOME_INSET, CONTROL_RULE)}>
        <ul className='grid grid-cols-3 gap-x-16 gap-y-20 max-sm:grid-cols-1 max-sm:gap-y-12 max-lg:grid-cols-2 max-lg:gap-y-16'>
          {CONTROLS.map(({ title, description, Mark }) => (
            <li key={title} className='flex flex-col items-start gap-3'>
              <Mark className={cn('size-[56px] max-sm:size-[48px]', CONTROL_QUIET)} />
              <div>
                <h3 className={cn('text-[var(--text-primary)]', HOME_TYPE.body)}>{title}</h3>
                <p className={cn('mt-1.5 max-w-[30ch] text-pretty', CONTROL_QUIET, CONTROL_COPY)}>
                  {description}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
