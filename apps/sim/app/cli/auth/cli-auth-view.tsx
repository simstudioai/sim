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

/** Sentinel for the "not bound to a workspace" row; an empty string reads as unselected. */
const PERSONAL_VALUE = '__personal__'

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
    return [...rows, { label: 'No workspace (personal key)', value: PERSONAL_VALUE }]
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

  // The terminal's suggestion, then the user's last active workspace. Derived at
  // render rather than synced into state through an effect, so the first paint
  // after the list loads already shows the right row.
  const workspaceId =
    selected ?? request.suggestedWorkspaceId ?? workspaces.data?.lastActiveWorkspaceId ?? null
  const chosen = workspaces.data?.workspaces.find((w) => w.id === workspaceId)

  // Only an admin can bind a key to a workspace. Anything less still gets a
  // usable credential — a personal key — but the card says which one before the
  // click rather than after, so nothing unexpected lands in the config file.
  const bindsToWorkspace = chosen?.permissions === 'admin'

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
              value={workspaceId ?? PERSONAL_VALUE}
              onChange={setSelected}
              disabled={workspaces.isLoading}
              placeholder='Select a workspace'
              searchable={options.length > 8}
              searchPlaceholder='Search workspaces'
              fullWidth
              dropdownWidth='trigger'
            />
            <p className='text-[var(--text-muted)] text-caption'>
              {bindsToWorkspace
                ? `Issues a key that can only reach ${chosen.name}.`
                : 'Issues a personal key tied to your account, defaulting to this workspace. Workspace-scoped keys need admin.'}
            </p>
          </div>
        )}
        <AuthSubmitButton
          type='button'
          loading={approve.isPending || approve.isSuccess}
          loadingLabel='Connecting'
          onClick={() =>
            approve.mutate(
              {
                request: request.request,
                challenge: request.challenge,
                scope: request.scope,
                // The picked workspace travels either way — it is the terminal's
                // default. Only `bindKeyToWorkspace` narrows the key itself.
                ...(isPlatform && chosen ? { workspaceId: chosen.id } : {}),
                bindKeyToWorkspace: isPlatform && bindsToWorkspace,
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
