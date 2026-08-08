'use client'

import { useMemo, useState } from 'react'
import { ChipSelect, type ChipSelectOption, Label } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { AuthFormMessage, AuthHeader, AuthSubmitButton } from '@/app/(auth)/components'
import { resolveCliAuthRequest } from '@/app/cli/auth/cli-auth-request'
import { cliAuthParsers } from '@/app/cli/auth/search-params'
import { useApproveCliAuth } from '@/hooks/queries/cli-auth'
import { useWorkspacesWithMetadata } from '@/hooks/queries/workspace'

/** Sentinel for the "no default workspace" row; an empty string reads as unselected. */
const NO_DEFAULT_WORKSPACE_VALUE = '__no_default_workspace__'

/**
 * The signed-in half of the CLI key handoff: a consent card that records the
 * user's approval so the terminal's poll can complete. No key passes through
 * the browser.
 *
 * The pairing code leads the card because it is the only signal that separates
 * the visitor's own terminal from a link someone sent them — an attacker who
 * opened the page supplies the request id and challenge, but not the code the
 * victim's terminal printed.
 */
export function CliAuthView() {
  const router = useRouter()
  const [params] = useQueryStates(cliAuthParsers)
  const approve = useApproveCliAuth()
  const [selected, setSelected] = useState<string | null>(null)

  const resolution = resolveCliAuthRequest(params)
  const isPlatform = resolution.valid && resolution.request.scope === 'platform'

  const workspaces = useWorkspacesWithMetadata(isPlatform)

  const options = useMemo<ChipSelectOption[]>(() => {
    const rows: ChipSelectOption[] = (workspaces.data?.workspaces ?? []).map((workspace) => ({
      label: workspace.name,
      value: workspace.id,
    }))
    return [...rows, { label: 'No default workspace', value: NO_DEFAULT_WORKSPACE_VALUE }]
  }, [workspaces.data])

  if (!resolution.valid) {
    return (
      <div className='space-y-6'>
        <AuthHeader
          title='Invalid request'
          description='This page can only be opened by the Sim CLI.'
        />
        <AuthFormMessage type='error' align='center'>
          {resolution.reason}
        </AuthFormMessage>
      </div>
    )
  }

  const { request } = resolution

  /**
   * Approval must wait for the workspace list.
   *
   * Until it arrives there is no selection to show, and the fallback would read
   * as "No default workspace" — a real answer, not a pending one. Leaving
   * Connect live through that window let a fast click save no default when a
   * moment later the same click would have saved the user's workspace. Blocking
   * is the only way the card can promise what it is about to configure.
   */
  const loadingWorkspaces = isPlatform && workspaces.isPending

  /**
   * The terminal's suggestion, then the user's last active workspace. Derived at
   * render rather than synced into state through an effect, so the first paint
   * after the list loads already shows the right row.
   *
   * The suggestion only counts when it resolves to a workspace the user
   * actually has. It comes from a profile the CLI wrote earlier, so it can name
   * a workspace they have since left or one that no longer exists — and being
   * merely truthy, it used to shadow the last-active fallback and leave the card
   * on "no workspace" with a perfectly good one available.
   */
  const suggested = workspaces.data?.workspaces.some((w) => w.id === request.suggestedWorkspaceId)
    ? request.suggestedWorkspaceId
    : null
  const workspaceId = selected ?? suggested ?? workspaces.data?.lastActiveWorkspaceId ?? null
  const chosen = workspaces.data?.workspaces.find((w) => w.id === workspaceId)

  return (
    <div className='space-y-6'>
      <AuthHeader
        title='Connect your terminal'
        description='Approve only if the code below matches the one in your terminal.'
      />
      <div className='space-y-4'>
        <div className='flex items-center justify-center rounded-[10px] border border-[var(--border-1)] py-5'>
          {/* `pl` offsets the trailing letter-space `tracking` adds after the last glyph, which would otherwise pull the code left of optical center. */}
          <code className='pl-[0.2em] font-mono text-[28px] text-[var(--text-primary)] leading-none tracking-[0.2em]'>
            {request.pairing}
          </code>
        </div>
        {isPlatform && (
          <div className='flex flex-col gap-[9px]'>
            <Label className='text-[var(--text-muted)] text-small'>Default workspace</Label>
            <ChipSelect
              options={options}
              value={workspaceId ?? NO_DEFAULT_WORKSPACE_VALUE}
              onChange={setSelected}
              disabled={loadingWorkspaces || workspaces.isError}
              // A placeholder only shows when nothing is selected, and the
              // fallback value always counts as a selection — so the loading
              // state has to override the rendered label outright.
              displayLabel={loadingWorkspaces ? 'Loading workspaces…' : undefined}
              placeholder='Select a workspace'
              searchable={options.length > 8}
              searchPlaceholder='Search workspaces'
              fullWidth
              dropdownWidth='trigger'
            />
            <p className='text-[var(--text-muted)] text-caption'>
              {loadingWorkspaces
                ? 'Loading your workspace options…'
                : workspaces.isError
                  ? 'Could not load your workspaces. Connecting still works and issues a personal key; reload to pick a default workspace.'
                  : chosen
                    ? `Issues a personal key tied to your account and makes ${chosen.name} the CLI default.`
                    : // No workspace picked, so none is sent and none becomes the
                      // profile default — promising one here would describe a
                      // grant that Connect is not about to make.
                      'Issues a personal key tied to your account, with no default workspace.'}
            </p>
          </div>
        )}
        <AuthSubmitButton
          type='button'
          loading={approve.isPending || approve.isSuccess}
          disabled={loadingWorkspaces}
          loadingLabel='Connecting'
          onClick={() =>
            approve.mutate(
              {
                request: request.request,
                challenge: request.challenge,
                scope: request.scope,
                // The picked workspace is only the terminal's default. Login
                // always mints a personal key so the profile can switch workspaces.
                ...(isPlatform && chosen ? { workspaceId: chosen.id } : {}),
                bindKeyToWorkspace: false,
              },
              { onSuccess: () => router.push('/cli/auth/done') }
            )
          }
        >
          Connect
        </AuthSubmitButton>
        {approve.isError && (
          <AuthFormMessage type='error' align='center'>
            {getErrorMessage(approve.error, 'Failed to connect. Please try again.')}
          </AuthFormMessage>
        )}
      </div>
    </div>
  )
}
