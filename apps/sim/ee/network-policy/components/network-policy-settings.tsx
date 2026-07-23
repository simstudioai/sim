'use client'

import { useEffect, useState } from 'react'
import { ChipTextarea, Label, Switch, toast } from '@sim/emcn'
import { isValidCidrEntry } from '@sim/platform-authz/network'
import { getErrorMessage } from '@sim/utils/errors'
import { MAX_IP_ALLOWLIST_ENTRIES } from '@/lib/api/contracts/organization'
import { saveDiscardActions } from '@/app/workspace/[workspaceId]/settings/components/save-discard-actions/save-discard-actions'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { useSettingsUnsavedGuard } from '@/app/workspace/[workspaceId]/settings/hooks/use-settings-unsaved-guard'
import {
  useOrganizationNetworkPolicy,
  useUpdateOrganizationNetworkPolicy,
} from '@/ee/network-policy/hooks/network-policy'

interface NetworkPolicySettingsProps {
  organizationId: string
}

function parseEntries(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export function NetworkPolicySettings({ organizationId }: NetworkPolicySettingsProps) {
  const { data, isLoading } = useOrganizationNetworkPolicy(organizationId)
  const updatePolicy = useUpdateOrganizationNetworkPolicy()

  const [enabled, setEnabled] = useState(false)
  const [cidrsText, setCidrsText] = useState('')
  const [savedEnabled, setSavedEnabled] = useState(false)
  const [savedCidrsText, setSavedCidrsText] = useState('')
  const [formInitialized, setFormInitialized] = useState(false)

  useEffect(() => {
    if (!data || formInitialized) return
    const text = data.configured.cidrs.join('\n')
    setEnabled(data.configured.enabled)
    setCidrsText(text)
    setSavedEnabled(data.configured.enabled)
    setSavedCidrsText(text)
    setFormInitialized(true)
  }, [data, formInitialized])

  const hasChanges =
    formInitialized && (enabled !== savedEnabled || cidrsText.trim() !== savedCidrsText.trim())

  useSettingsUnsavedGuard({ isDirty: hasChanges })

  if (isLoading) {
    return (
      <SettingsPanel>
        <SettingsEmptyState>Loading IP access settings...</SettingsEmptyState>
      </SettingsPanel>
    )
  }

  if (data && !data.isEnterprise) {
    return (
      <SettingsPanel>
        <SettingsEmptyState>
          IP access restrictions are available on Enterprise plans only.
        </SettingsEmptyState>
      </SettingsPanel>
    )
  }

  async function handleSave() {
    const cidrs = parseEntries(cidrsText)

    if (enabled && cidrs.length === 0) {
      toast.error('Add at least one IP or CIDR range before enabling the allowlist')
      return
    }
    if (cidrs.length > MAX_IP_ALLOWLIST_ENTRIES) {
      toast.error(`At most ${MAX_IP_ALLOWLIST_ENTRIES} allowlist entries`)
      return
    }
    const invalid = cidrs.filter((entry) => !isValidCidrEntry(entry))
    if (invalid.length > 0) {
      toast.error(`Invalid entr${invalid.length === 1 ? 'y' : 'ies'}: ${invalid.join(', ')}`)
      return
    }

    try {
      const result = await updatePolicy.mutateAsync({
        orgId: organizationId,
        settings: { ipAllowlist: { enabled, cidrs } },
      })
      const savedText = result.data.configured.cidrs.join('\n')
      setEnabled(result.data.configured.enabled)
      setCidrsText(savedText)
      setSavedEnabled(result.data.configured.enabled)
      setSavedCidrsText(savedText)
      toast.success('IP access settings updated')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update IP access settings'))
    }
  }

  function handleDiscard() {
    setEnabled(savedEnabled)
    setCidrsText(savedCidrsText)
  }

  return (
    <SettingsPanel
      actions={saveDiscardActions({
        dirty: hasChanges,
        saving: updatePolicy.isPending,
        onSave: handleSave,
        onDiscard: handleDiscard,
      })}
    >
      <div className='flex flex-col gap-7'>
        <div className='flex items-center justify-between'>
          <div className='flex flex-col gap-1'>
            <Label htmlFor='ip-allowlist-enabled'>Restrict access by IP</Label>
            <p className='text-[var(--text-muted)] text-caption'>
              Members can only sign in and use Sim from the addresses below.
            </p>
          </div>
          <Switch id='ip-allowlist-enabled' checked={enabled} onCheckedChange={setEnabled} />
        </div>
        <div className='flex flex-col gap-[9px]'>
          <Label htmlFor='ip-allowlist-cidrs' className='font-normal text-[var(--text-muted)]'>
            Allowed IPs and CIDR ranges
          </Label>
          <ChipTextarea
            id='ip-allowlist-cidrs'
            value={cidrsText}
            onChange={(event) => setCidrsText(event.target.value)}
            placeholder={'203.0.113.7 # Office\n10.0.0.0/16 # Frankfurt VPN\n2001:db8::/48'}
            rows={8}
          />
          <p className='text-[var(--text-muted)] text-caption'>
            One entry per line — IPv4/IPv6 addresses or CIDR ranges with an optional {'# label'}, up
            to {MAX_IP_ALLOWLIST_ENTRIES} entries.
            {data?.callerIp
              ? ` Your current IP is ${data.callerIp}; saving a list that excludes it is rejected.`
              : ''}
          </p>
        </div>
      </div>
    </SettingsPanel>
  )
}
