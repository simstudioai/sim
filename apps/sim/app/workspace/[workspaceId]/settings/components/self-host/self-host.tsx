'use client'

import { ChipLink } from '@sim/emcn'
import { SITE_URL } from '@/lib/core/utils/urls'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'

/** Chat keys are issued by the managed service, not by this deployment. */
const CHAT_KEYS_HREF = `${SITE_URL}/selfhost/settings/chat-keys`

export function SelfHost() {
  return (
    <SettingsPanel>
      <div className='flex items-center justify-between px-2'>
        <div className='flex flex-col justify-center gap-[1px]'>
          <span className='text-[var(--text-body)] text-sm'>Chat keys</span>
          <span className='text-[var(--text-muted)] text-caption'>
            Model-provider keys that power Chat on this deployment.
          </span>
        </div>
        <ChipLink href={CHAT_KEYS_HREF} target='_blank' rel='noopener noreferrer'>
          Managed keys
        </ChipLink>
      </div>
    </SettingsPanel>
  )
}
