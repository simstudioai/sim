'use client'

import { useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipSwitch,
  toast,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import type { SearchIntegrationApproval } from '@/lib/api/contracts/knowledge/search-integrations'
import { connectorDisplayName } from '@/lib/sim-search/connectors'
import {
  defaultLiveSearchPolicy,
  LIVE_SEARCH_SCOPE_FIELDS,
  normalizeLiveSearchPolicy,
} from '@/lib/sim-search/live/policy-schema'
import { useUpdateSearchIntegration } from '@/hooks/queries/search-integrations'

interface LiveSearchPolicyModalProps {
  organizationId: string
  integration: SearchIntegrationApproval
  onClose: () => void
}

export function LiveSearchPolicyModal({
  organizationId,
  integration,
  onClose,
}: LiveSearchPolicyModalProps) {
  const update = useUpdateSearchIntegration()
  const [policy, setPolicy] = useState(integration.policy ?? defaultLiveSearchPolicy())
  const [approved, setApproved] = useState(integration.approved)
  const [included, setIncluded] = useState(policy.included.join('\n'))
  const [excluded, setExcluded] = useState(policy.excluded.join('\n'))
  const [sites, setSites] = useState(policy.sites.join('\n'))
  const [paths, setPaths] = useState(policy.pathPrefixes.join('\n'))
  const [fileTypes, setFileTypes] = useState(policy.fileTypes.join('\n'))
  const [error, setError] = useState('')
  const provider = integration.connectorType
  const fields = LIVE_SEARCH_SCOPE_FIELDS[provider]!
  const close = () => {
    if (!update.isPending) onClose()
  }
  const list = (value: string) =>
    value
      .split(/[\n,]/)
      .map((part) => part.trim())
      .filter(Boolean)
  const save = () => {
    if (update.isPending) return
    try {
      const normalized = approved
        ? normalizeLiveSearchPolicy(provider, {
            ...policy,
            included: list(included),
            excluded: list(excluded),
            sites: list(sites),
            pathPrefixes: list(paths),
            fileTypes: list(fileTypes),
          })
        : undefined
      setError('')
      update.mutate(
        { organizationId, connectorType: provider, approved, policy: normalized },
        {
          onSuccess: () => {
            toast.success('Search settings saved')
            onClose()
          },
        }
      )
    } catch (error) {
      setError(getErrorMessage(error, 'Check the source IDs and try again.'))
    }
  }
  const boolean = (
    key:
      | 'includeSubfolders'
      | 'includeDirectMessages'
      | 'includeArchived'
      | 'includeAttendees'
      | 'excludePromotions'
      | 'excludeSocial',
    title: string,
    hint?: string
  ) => (
    <ChipModalField type='custom' title={title} hint={hint}>
      <ChipSwitch
        aria-label={title}
        value={policy[key] ? 'yes' : 'no'}
        onChange={(value) => setPolicy({ ...policy, [key]: value === 'yes' })}
        options={[
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ]}
      />
    </ChipModalField>
  )
  return (
    <ChipModal
      open
      dismissDisabled={update.isPending}
      onOpenChange={(open) => {
        if (!open) close()
      }}
      srTitle={`${connectorDisplayName(provider)} search settings`}
    >
      <ChipModalHeader onClose={close}>{connectorDisplayName(provider)}</ChipModalHeader>
      <ChipModalBody className='max-h-[70dvh] overflow-y-auto'>
        <fieldset disabled={update.isPending} className='flex min-w-0 flex-col gap-4'>
          <ChipModalField
            type='custom'
            title='Organization search'
            hint={
              provider === 'gitlab'
                ? 'Admins manage project connections. Results follow the source’s configured permissions.'
                : 'Members search with their own accounts and permissions.'
            }
          >
            <ChipSwitch
              aria-label='Organization search'
              value={approved ? 'enabled' : 'disabled'}
              onChange={(value) => setApproved(value === 'enabled')}
              options={[
                { value: 'enabled', label: 'Enabled' },
                { value: 'disabled', label: 'Disabled' },
              ]}
            />
          </ChipModalField>
          <ChipModalField type='custom' title='Search scope'>
            <ChipSwitch
              aria-label='Search scope'
              value={policy.mode}
              onChange={(mode) => setPolicy({ ...policy, mode })}
              options={[
                { value: 'all', label: 'All accessible sources' },
                { value: 'selected', label: 'Selected sources' },
              ]}
            />
          </ChipModalField>
          {policy.mode === 'selected' && (
            <ChipModalField
              type='textarea'
              title={fields.label}
              value={included}
              onChange={setIncluded}
              placeholder={fields.example}
              hint={`${fields.hint} One per line.`}
              required
              rows={3}
            />
          )}
          <ChipModalField
            type='textarea'
            title={`Excluded ${fields.label.toLowerCase()}`}
            value={excluded}
            onChange={setExcluded}
            placeholder={fields.example}
            hint='Optional. Exclusions always take priority.'
            rows={2}
          />
          {provider === 'google_drive' && (
            <>
              {boolean(
                'includeSubfolders',
                'Include subfolders',
                'Applies to selected folders. Shared drives always include their contents.'
              )}
              <ChipModalField
                type='textarea'
                title='File types'
                value={fileTypes}
                onChange={setFileTypes}
                placeholder='application/pdf'
                hint='Optional. Only these MIME types can be searched. One per line.'
                rows={2}
              />
            </>
          )}
          {provider === 'slack' &&
            boolean(
              'includeDirectMessages',
              'Include direct messages',
              'Includes one-to-one and group DMs the member can access.'
            )}
          {['slack', 'github', 'gitlab'].includes(provider) &&
            boolean('includeArchived', 'Include archived sources')}
          {provider === 'google_calendar' && boolean('includeAttendees', 'Show event attendees')}
          {provider === 'gmail' && (
            <>
              {boolean('excludePromotions', 'Exclude promotions')}
              {boolean('excludeSocial', 'Exclude social updates')}
            </>
          )}
          {['slack', 'gitlab', 'jira', 'confluence'].includes(provider) && (
            <ChipModalField
              type='textarea'
              title='Allowed sites'
              value={sites}
              onChange={setSites}
              placeholder={
                provider === 'gitlab'
                  ? 'gitlab.example.com'
                  : provider === 'slack'
                    ? 'company.slack.com'
                    : 'company.atlassian.net'
              }
              hint='Optional. Only these connected sites can be searched. One hostname per line; include a custom port if needed.'
              rows={2}
            />
          )}
          {['github', 'gitlab'].includes(provider) && (
            <ChipModalField
              type='textarea'
              title='Code paths'
              value={paths}
              onChange={setPaths}
              placeholder='src\npackages'
              hint='Optional. Limit code results to these paths. Issues and other content are unaffected.'
              rows={2}
            />
          )}
          <ChipModalError>{error || update.error?.message}</ChipModalError>
        </fieldset>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={close}
        primaryAction={{
          label: update.isPending ? 'Saving…' : 'Save settings',
          onClick: save,
          disabled: update.isPending,
        }}
      />
    </ChipModal>
  )
}
