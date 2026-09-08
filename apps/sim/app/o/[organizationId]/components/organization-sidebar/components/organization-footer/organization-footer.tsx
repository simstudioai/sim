'use client'

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
import { BookOpen, Download, HelpCircle, Settings } from '@sim/emcn/icons'
import Link from 'next/link'
import { SlackIcon } from '@/components/icons'
import { getDesktopUpdates } from '@/lib/desktop'
import { organizationRoutes } from '@/lib/navigation/paths'
import { getUserColor } from '@/lib/workspaces/colors'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { SidebarTooltip } from '@/app/workspace/[workspaceId]/w/components/sidebar/components'
import {
  SIDEBAR_ITEM_GAP_CLASS,
  SIDEBAR_RAIL_CHIP_CLASS,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { useUserProfile } from '@/hooks/queries/user-profile'
import { useDesktopUpdateState } from '@/hooks/use-desktop-update-state'

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

interface OrganizationFooterProps {
  /**
   * True while the scroll region above still hides rows beyond its bottom edge —
   * the same test the divider under the pinned nav applies at the top. The bar's
   * top rule is drawn only then, so a list that fits meets the footer with no line.
   */
  showDivider: boolean
  isCollapsed: boolean
  showCollapsedTooltips: boolean
  onOpenDocs: () => void
  onJoinSlack: () => void
}

/**
 * Pinned bottom bar of the organization sidebar: the viewer's avatar and name,
 * which open their account settings, plus a help menu. Same two elements and the
 * same layout as the workspace footer — expanded they share one row with help hard
 * right, collapsed they stack as icon chips with help on top.
 *
 * Collapsed reverses the flex direction instead of reordering the DOM, which keeps
 * both elements (and the help menu's trigger) alive across a toggle.
 */
export function OrganizationFooter({
  showDivider,
  isCollapsed,
  showCollapsedTooltips,
  onOpenDocs,
  onJoinSlack,
}: OrganizationFooterProps) {
  const { organization } = useOrganizationContext()
  const { data: profile } = useUserProfile()
  const updateState = useDesktopUpdateState()

  const name = profile ? profile.name?.trim() || profile.email : ''
  const updateAvailable = hasAvailableDesktopUpdate(updateState)

  const handleUpdateSelect = () => {
    const updates = getDesktopUpdates()
    if (updateState.status === 'ready') {
      updates?.install()
    } else if (updateState.status === 'available') {
      updates?.check()
    }
  }

  /**
   * Plain `img`/`div` rather than the emcn `Avatar`, whose Radix root renders a
   * `<span>` — and globals fade every `span` in the collapsed rail to `opacity: 0`,
   * which would blank the avatar exactly where it is the only thing left to see.
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
   * rather than overflowing); collapsed, `fullWidth` fills the narrow rail and
   * `min-w-0` lets the hidden label give up its box so the chip never overflows it.
   * The name is the button's accessible name — no `aria-label`, which would
   * override the visible text.
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
        <DropdownMenuItem asChild>
          <Link href={organizationRoutes(organization.id).settingsSection('general')}>
            <Settings className='size-[14px]' />
            <DropdownMenuItemLabel label='Settings' />
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  /**
   * One node across both states; only `fullWidth` changes, so the same Radix menu
   * survives the transition. `shrink-0` keeps the chip off the avatar while the rail
   * is briefly narrower than the row — the aside's clip hides it until there is room.
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
      {/* Expanded, claims the row's free width so the help button lands hard right.
          `flex` makes the inline-flex chip a flex item, so the wrapper is exactly the
          chip's 30px rather than a line box padded by the strut's half-leading. */}
      <div className={cn('flex', !isCollapsed && 'flex-1')}>{profileMenu}</div>
      {helpMenu}
    </div>
  )
}
