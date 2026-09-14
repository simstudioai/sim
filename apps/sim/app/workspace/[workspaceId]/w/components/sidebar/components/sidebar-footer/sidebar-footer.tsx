'use client'

import type { ComponentType } from 'react'
import type { DesktopUpdateState } from '@sim/desktop-bridge'
import {
  Chip,
  chipContentLabelClass,
  chipPrimaryFillTokens,
  chipVariants,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  OverflowText,
  Skeleton,
} from '@sim/emcn'
import { BookOpen, Download, HelpCircle, LogOut, Settings } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { SlackIcon } from '@/components/icons'
import { SettingsIntentLink } from '@/components/settings/settings-intent-link'
import { ANONYMOUS_USER_ID } from '@/lib/auth/constants'
import { signOutAndRedirect } from '@/lib/auth/sign-out'
import { getDesktopUpdates } from '@/lib/desktop'
import { getUserColor } from '@/lib/workspaces/colors'
import { SidebarTooltip } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/sidebar-tooltip'
import {
  SIDEBAR_ITEM_GAP_CLASS,
  SIDEBAR_RAIL_CHIP_CLASS,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { useUserProfile } from '@/hooks/queries/user-profile'
import { useDesktopUpdateState } from '@/hooks/use-desktop-update-state'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

function hasAvailableDesktopUpdate(state: DesktopUpdateState): boolean {
  return state.status === 'available' || state.status === 'downloading' || state.status === 'ready'
}

function desktopUpdateActionLabel(state: DesktopUpdateState): string {
  if (state.status === 'downloading') {
    return state.percent === undefined
      ? 'Downloading update…'
      : `Downloading update ${state.percent}%`
  }
  return state.status === 'ready' ? 'Restart to update' : 'Update'
}

/** Compact primary update circle using the same footprint as the surrounding sidebar icons. */
function DesktopUpdateIcon({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        className,
        'flex size-[17px] shrink-0 items-center justify-center rounded-full',
        chipPrimaryFillTokens
      )}
    >
      {/* Download's default viewBox is asymmetric around its paths. Center the
          artwork itself, not merely its SVG box, inside the avatar-sized circle. */}
      <Download className='size-[11px]' viewBox='-1.75 -1.75 24 24' />
    </div>
  )
}

interface SidebarNavigationLink {
  label: string
  icon: ComponentType<{ className?: string }>
  href: string
  onNavigate: () => void
}

interface SidebarFooterProps {
  /**
   * True while the scroll region above still hides rows beyond its bottom edge —
   * the same test the divider under the pinned nav applies at the top. The bar's
   * top rule is drawn only then, so a list that fits meets the footer with no line.
   */
  showDivider: boolean
  isCollapsed: boolean
  showCollapsedTooltips: boolean
  accountSettingsHref: string
  onOpenAccountSettings: () => void
  navigationLinks: readonly SidebarNavigationLink[]
  onOpenDocs: () => void
  onJoinSlack: () => void
  onContactSupport: () => void
}

/**
 * Shared account and Help menus for the workspace and organization sidebars.
 *
 * Expanded, the two share one row — the profile claims the free width so the help
 * button lands hard right, mirroring the collapse control in the workspace header.
 * Collapsed, the rail is too narrow for a row, so they stack as icon chips with
 * help on top and the profile resting at the foot of the rail.
 *
 * Both layouts are the same two elements — only the container's direction and the
 * children's classes change — because `isCollapsed` flips in one frame while the
 * rail takes 200ms to widen, so the row spends that window laid out at a width it
 * does not fit in. Neither element may give ground there: the profile stops at its
 * avatar (no `min-w-0`) and the help button never shrinks, so the row overflows the
 * narrow rail and the aside's `overflow-hidden` clips it. The avatar keeps the exact
 * position it holds collapsed, and the `?` rides in on the opening edge — paced by
 * the rail itself rather than by a duration of its own.
 *
 * Collapsed reverses the flex direction instead of reordering the DOM, which is what
 * keeps both elements (and the help menu's trigger) alive across a toggle. The cost
 * is bottom-up focus order there, a smaller price for one pair of adjacent controls
 * than remounting a trigger mid-animation.
 */
export function SidebarFooter({
  showDivider,
  isCollapsed,
  showCollapsedTooltips,
  accountSettingsHref,
  onOpenAccountSettings,
  navigationLinks,
  onOpenDocs,
  onJoinSlack,
  onContactSupport,
}: SidebarFooterProps) {
  const { data: profile } = useUserProfile()
  const router = useRouter()
  const updateState = useDesktopUpdateState()

  const name = profile ? profile.name?.trim() || profile.email : ''
  const updateAvailable = hasAvailableDesktopUpdate(updateState)
  const canSignOut = Boolean(profile && profile.id !== ANONYMOUS_USER_ID)

  const handleUpdateSelect = () => {
    const updates = getDesktopUpdates()
    if (updateState.status === 'ready') {
      updates?.install()
    } else if (updateState.status === 'available') {
      updates?.check()
    }
  }

  /**
   * Built from plain `img`/`div` rather than the emcn `Avatar`, whose Radix root
   * renders a `<span>` — and globals fade every `span` in the collapsed rail to
   * `opacity: 0`, which blanked the avatar exactly where it is the only thing
   * left to see. The workspace header's logo sidesteps the same rule the same way.
   */
  const avatar = !profile ? (
    <Skeleton className='size-[16px] shrink-0 rounded-full' />
  ) : profile.image ? (
    <img
      src={profile.image}
      alt=''
      referrerPolicy='no-referrer'
      className='size-[16px] shrink-0 rounded-full object-cover'
    />
  ) : (
    <div
      className='flex size-[16px] shrink-0 items-center justify-center rounded-full text-[9px] text-white leading-none'
      style={{ backgroundColor: getUserColor(profile.id) }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  )

  /**
   * Expanded, the chip hugs its content (`max-w-full` so a long name truncates
   * rather than overflowing) and the free width belongs to the wrapper it sits in,
   * so hover highlights only the avatar and name. Collapsed, `fullWidth` fills the
   * narrow rail instead. Both mirror the workspace header's chip exactly.
   *
   * No `min-w-0` expanded: the label already truncates on its own, and letting the
   * chip shrink past its avatar is what let the help button ride onto the photo
   * while the rail was still narrow (see {@link SidebarFooter}).
   *
   * Collapsed it takes `min-w-0`, because the label stays in the layout there — the
   * rail hides it with `opacity`, not `display`, so the fade survives a toggle. Its
   * empty box still contributes the content row's gap, putting the chip's automatic
   * minimum at 38px against a 35px rail: the chip overflowed, the aside clipped its
   * right edge, and the hover fill read as a full-width row bleeding off the rail
   * instead of the padded pill every other collapsed chip draws. Floored at zero it
   * fills exactly the rail, and the avatar keeps the same 8px offset as the help
   * glyph above it.
   *
   * The name is the button's accessible name — no `aria-label`, which would
   * override the visible text. Radix contributes the menu role and expanded state.
   */
  const profileMenu = (
    <DropdownMenu>
      <SidebarTooltip label={name} enabled={showCollapsedTooltips && Boolean(name)}>
        <DropdownMenuTrigger asChild>
          <button
            type='button'
            data-item-id='profile'
            className={cn(
              chipVariants({ fullWidth: isCollapsed }),
              isCollapsed ? 'min-w-0' : 'max-w-full',
              SIDEBAR_RAIL_CHIP_CLASS
            )}
          >
            {avatar}
            {profile ? (
              <OverflowText
                label={name}
                className={cn('sidebar-collapse-hide flex-1', chipContentLabelClass)}
                tooltipEnabled={!isCollapsed && !showCollapsedTooltips}
                focusTarget='nearest-interactive'
              />
            ) : (
              /* Fixed width — the chip hugs its content, so a flexible bar would collapse to nothing. */
              <Skeleton className='sidebar-collapse-hide h-[14px] w-[96px] rounded-sm' />
            )}
          </button>
        </DropdownMenuTrigger>
      </SidebarTooltip>
      <DropdownMenuContent align='start' side='top' sideOffset={4}>
        {[
          {
            label: 'Settings',
            icon: Settings,
            href: accountSettingsHref,
            onNavigate: onOpenAccountSettings,
          },
          ...navigationLinks,
        ].map(({ label, icon: Icon, href, onNavigate }) => (
          <DropdownMenuItem key={href} asChild>
            <SettingsIntentLink
              href={href}
              onNavigate={(event) => {
                event.preventDefault()
                useSettingsDirtyStore.getState().requestLeave(onNavigate)
              }}
            >
              <Icon className='size-[14px]' />
              <DropdownMenuItemLabel label={label} />
            </SettingsIntentLink>
          </DropdownMenuItem>
        ))}
        {canSignOut && (
          <DropdownMenuItem
            onSelect={() => {
              useSettingsDirtyStore.getState().requestLeave(() => {
                void signOutAndRedirect(router.push)
              })
            }}
          >
            <LogOut className='size-[14px]' />
            Sign out
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  /**
   * The same `Chip` the workspace header uses for Search and Collapse, so the two
   * ends of the rail carry identical chrome — box, radius, hover fill, and glyph
   * size all come from the component rather than a local class string.
   *
   * One node across both states; only `fullWidth` changes (collapsed it fills the
   * rail, expanded it hugs its icon). Toggling a prop rather than rendering two
   * buttons keeps the same DOM node — and the same Radix menu — alive through the
   * transition instead of tearing one trigger down and mounting another mid-animation.
   *
   * Icon-only in both: the collapsed rail hides labels anyway. The tooltip names it
   * while the rail is collapsed.
   */
  const helpMenu = (
    <DropdownMenu>
      <SidebarTooltip
        label={updateAvailable ? 'Help — update available' : 'Help'}
        enabled={showCollapsedTooltips}
      >
        <DropdownMenuTrigger asChild>
          <Chip
            data-item-id='help'
            aria-label={updateAvailable ? 'Help, update available' : 'Help'}
            leftIcon={updateAvailable ? DesktopUpdateIcon : HelpCircle}
            fullWidth={isCollapsed}
            /* Never shrinks: while the rail animates open the row is briefly wider
               than the rail, and a shrinking chip would be squeezed onto the avatar.
               Holding its size pushes it past the edge, where the aside's clip hides
               it until there is room. */
            className={cn('shrink-0', SIDEBAR_RAIL_CHIP_CLASS)}
          />
        </DropdownMenuTrigger>
      </SidebarTooltip>
      {/* Anchored to whichever edge the trigger sits on, so the menu never overhangs the rail. */}
      <DropdownMenuContent align={isCollapsed ? 'start' : 'end'} side='top' sideOffset={4}>
        {updateAvailable && (
          <>
            <DropdownMenuItem
              onSelect={handleUpdateSelect}
              disabled={updateState.status === 'downloading'}
            >
              <img src='/favicon/favicon-32x32.png' alt='' className='size-[14px] rounded-[3px]' />
              {desktopUpdateActionLabel(updateState)}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={onOpenDocs}>
          <BookOpen className='size-[14px]' />
          Docs
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onJoinSlack}>
          <SlackIcon className='size-[14px]' />
          Join Slack
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onContactSupport}>
          <HelpCircle className='size-[14px]' />
          Contact support
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div
      className={cn(
        'flex shrink-0 border-t px-2 pt-[9px] pb-2 transition-colors duration-150',
        !showDivider && 'border-transparent',
        isCollapsed ? cn(SIDEBAR_ITEM_GAP_CLASS, 'flex-col-reverse') : 'items-center'
      )}
    >
      {/* Expanded, claims the row's free width so the help button lands hard right —
          the same wrapper the workspace header puts around its chip. `flex` makes the
          inline-flex chip a flex item rather than an inline one, so the wrapper is
          exactly the chip's 30px instead of a line box padded by the strut's
          half-leading, which would deepen the bar below the chip. Collapsed, it
          stretches to the rail on its own and the chip fills it. */}
      <div className={cn('flex min-w-0', !isCollapsed && 'flex-1')}>{profileMenu}</div>
      {helpMenu}
    </div>
  )
}
