'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQueryStates } from 'nuqs'
import {
  defaultTimeRange,
  ENV_OPTIONS,
  formatCost,
  formatDate,
  TABS,
  toRFC3339,
} from '@/app/workspace/[workspaceId]/settings/components/mothership/format'
import {
  type MothershipTab,
  mothershipParsers,
  mothershipUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/components/mothership/search-params'
import { useLicenseForm } from '@/app/workspace/[workspaceId]/settings/components/mothership/use-license-form'
import {
  type MothershipEnv,
  useMothershipLicenses,
  useMothershipRequests,
  useMothershipUserBreakdown,
} from '@/hooks/queries/mothership-admin'
import { useCaptureWhenReady } from '@/hooks/use-capture-when-ready'
import {
  Button,
  CopyField,
  DataTable,
  EmptyState,
  InlineNotice,
  LoadingRows,
  MetricGroup,
  SegmentedControl,
  SelectField,
  StatusTag,
  TextField,
} from '@/platform/design-system/components'
import { SettingsSection } from '@/platform/design-system/components/settings-section/settings-section'
import {
  ActionRow,
  FieldStack,
  Muted,
  SectionStack,
  SectionToolbar,
} from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

const REQUEST_LIMIT = 100

export default function MothershipSection() {
  useCaptureWhenReady(
    'settings_tab_viewed',
    { plane: 'account', section: 'mothership' },
    'mothership'
  )
  const [{ tab: activeTab, env: environment }, setParams] = useQueryStates(
    mothershipParsers,
    mothershipUrlKeys
  )
  const defaults = defaultTimeRange()
  const [start, setStart] = useState(defaults.start)
  const [end, setEnd] = useState(defaults.end)
  const requestLeave = useSettingsDirtyStore((state) => state.requestLeave)
  return (
    <SectionStack>
      <SectionToolbar>
        <SelectField
          label='Environment'
          value={environment}
          options={ENV_OPTIONS}
          onValueChange={(value) => {
            if (value !== environment)
              requestLeave(() => void setParams({ env: value as MothershipEnv }))
          }}
        />
        <TextField label='From' type='datetime-local' value={start} onChange={setStart} />
        <TextField label='To' type='datetime-local' value={end} onChange={setEnd} />
      </SectionToolbar>
      <ActionRow>
        <SegmentedControl
          label='Mothership views'
          value={activeTab}
          options={TABS.map((tab) => ({ value: tab.id, label: tab.label }))}
          onSelect={(value: MothershipTab) => {
            if (value !== activeTab) requestLeave(() => void setParams({ tab: value }))
          }}
        />
      </ActionRow>
      {activeTab === 'overview' && (
        <Overview environment={environment} start={toRFC3339(start)} end={toRFC3339(end)} />
      )}
      {activeTab === 'licenses' && <Licenses environment={environment} />}
      {activeTab === 'byok' && <Byok />}
    </SectionStack>
  )
}

function Byok() {
  const [targetWorkspaceId, setTargetWorkspaceId] = useState('')
  const workspaceId = targetWorkspaceId.trim()
  return (
    <SettingsSection title='BYOK'>
      <FieldStack>
        <Muted>
          Mothership uses the enterprise workspace&apos;s Anthropic key from Sim BYOK settings,
          including keys inherited from its organization.
        </Muted>
        <TextField
          label='Target workspace'
          placeholder='Workspace ID'
          value={targetWorkspaceId}
          onChange={setTargetWorkspaceId}
        />
        {workspaceId && (
          <ActionRow>
            <Button
              size='compact'
              render={<Link href={`/workspace/${encodeURIComponent(workspaceId)}/settings/byok`} />}
            >
              Manage workspace BYOK keys
            </Button>
          </ActionRow>
        )}
      </FieldStack>
    </SettingsSection>
  )
}

interface OverviewProps {
  environment: MothershipEnv
  start: string
  end: string
}

const USER_COLUMNS = [
  { key: 'user', label: 'User ID', kind: 'text' },
  { key: 'requests', label: 'Requests', kind: 'number' },
  { key: 'cost', label: 'Cost', kind: 'text' },
  { key: 'last', label: 'Last request', kind: 'text' },
] as const

const REQUEST_COLUMNS = [
  { key: 'id', label: 'Request ID', kind: 'text' },
  { key: 'model', label: 'Model', kind: 'text' },
  { key: 'duration', label: 'Duration', kind: 'text' },
  { key: 'cost', label: 'Cost', kind: 'text' },
  { key: 'tools', label: 'Tools', kind: 'number' },
  { key: 'status', label: 'Status', kind: 'status' },
  { key: 'time', label: 'Time', kind: 'text' },
] as const

function Overview({ environment, start, end }: OverviewProps) {
  const { data: breakdown, isLoading: breakdownLoading } = useMothershipUserBreakdown(
    environment,
    start,
    end
  )
  const { data: requests, isLoading: requestsLoading } = useMothershipRequests(
    environment,
    start,
    end
  )
  const totalCost = breakdown?.users?.reduce(
    (sum: number, user: { total_cost: number }) => sum + user.total_cost,
    0
  )
  const metric = (value: string | number | undefined) => (breakdownLoading ? '…' : (value ?? '—'))
  return (
    <>
      <MetricGroup
        metrics={[
          { label: 'Total requests', value: metric(breakdown?.total_requests) },
          { label: 'Unique users', value: metric(breakdown?.total_users) },
          {
            label: 'Total cost',
            value: metric(totalCost === undefined ? undefined : formatCost(totalCost)),
          },
          {
            label: 'Avg. cost per request',
            value: metric(
              breakdown?.total_requests && totalCost !== undefined
                ? formatCost(totalCost / breakdown.total_requests)
                : undefined
            ),
          },
        ]}
      />
      {breakdownLoading && (
        <SettingsSection title='User breakdown'>
          <LoadingRows label='Loading user breakdown' rows={5} />
        </SettingsSection>
      )}
      {breakdown?.users && (
        <DataTable
          title='User breakdown'
          columns={USER_COLUMNS}
          rows={breakdown.users.map(
            (user: {
              user_id: string
              request_count: number
              total_cost: number
              last_request: string
            }) => ({
              id: user.user_id,
              values: {
                user: user.user_id,
                requests: user.request_count,
                cost: formatCost(user.total_cost),
                last: formatDate(user.last_request),
              },
            })
          )}
        />
      )}
      {requestsLoading && (
        <SettingsSection title='Recent requests'>
          <LoadingRows label='Loading recent requests' rows={5} />
        </SettingsSection>
      )}
      {requests?.requests && (
        <DataTable
          title={`Recent requests (${requests.count ?? '…'})`}
          columns={REQUEST_COLUMNS}
          rows={requests.requests
            .slice(0, REQUEST_LIMIT)
            .map(
              (request: {
                request_id: string
                model: string
                duration_ms: number
                billed_total_cost: number
                tool_call_count: number
                error: boolean
                aborted: boolean
                created_at: string
              }) => ({
                id: request.request_id,
                values: {
                  id: request.request_id ?? '—',
                  model: (request.model ?? '').replace('claude-', ''),
                  duration: request.duration_ms
                    ? `${(request.duration_ms / 1000).toFixed(1)}s`
                    : '—',
                  cost: formatCost(request.billed_total_cost ?? 0),
                  tools: request.tool_call_count ?? 0,
                  status: request.error ? 'Error' : request.aborted ? 'Abort' : 'OK',
                  time: formatDate(request.created_at),
                },
                cells: {
                  status: request.error ? (
                    <StatusTag label='Error' intent='danger' />
                  ) : request.aborted ? (
                    <StatusTag label='Abort' intent='warning' />
                  ) : (
                    <StatusTag label='OK' intent='success' />
                  ),
                },
              })
            )}
        />
      )}
    </>
  )
}

interface LicensesProps {
  environment: MothershipEnv
}

const LICENSE_COLUMNS = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'validations', label: 'Validations', kind: 'number' },
  { key: 'expiration', label: 'Expiration', kind: 'text' },
  { key: 'created', label: 'Created', kind: 'text' },
] as const

function Licenses({ environment }: LicensesProps) {
  const { data, isLoading } = useMothershipLicenses(environment)
  const form = useLicenseForm(environment)
  const { generateLicense, generatedKey } = form
  return (
    <>
      <SettingsSection title='Generate license'>
        <FieldStack>
          <TextField
            label='Enterprise name'
            placeholder='e.g. Acme Corp'
            disabled={generateLicense.isPending}
            value={form.newName}
            onChange={form.setNewName}
          />
          <TextField
            label='Approval reference'
            placeholder='Signed order form or written approval'
            disabled={generateLicense.isPending}
            value={form.approvalReference}
            onChange={form.setApprovalReference}
          />
          <TextField
            label='Expiration'
            optional
            type='date'
            disabled={generateLicense.isPending}
            value={form.newExpiry}
            onChange={form.setNewExpiry}
          />
          <ActionRow>
            <Button
              variant='primary'
              size='compact'
              disabled={
                generateLicense.isPending ||
                Boolean(generatedKey) ||
                !form.newName.trim() ||
                !form.approvalReference.trim()
              }
              onClick={form.handleGenerate}
            >
              {generateLicense.isPending ? 'Generating…' : 'Generate'}
            </Button>
          </ActionRow>
          {generatedKey && (
            <>
              <CopyField label='License key' value={generatedKey} hint='Only shown once.' />
              <ActionRow>
                <Button size='compact' onClick={() => form.setGeneratedKey(null)}>
                  Done
                </Button>
              </ActionRow>
            </>
          )}
          {generateLicense.error && (
            <InlineNotice intent='danger' message={generateLicense.error.message} />
          )}
        </FieldStack>
      </SettingsSection>
      {isLoading && (
        <SettingsSection title='All licenses'>
          <LoadingRows label='Loading licenses' />
        </SettingsSection>
      )}
      {data?.licenses &&
        (data.licenses.length === 0 ? (
          <SettingsSection title='All licenses'>
            <EmptyState title='No licenses found.' />
          </SettingsSection>
        ) : (
          <DataTable
            title='All licenses'
            columns={LICENSE_COLUMNS}
            rows={data.licenses.map(
              (license: {
                id: string
                name: string
                count: number
                expiration_date?: string
                created_at: string
              }) => ({
                id: license.id,
                values: {
                  name: license.name,
                  validations: license.count,
                  expiration: license.expiration_date
                    ? formatDate(license.expiration_date)
                    : 'Never',
                  created: formatDate(license.created_at),
                },
              })
            )}
          />
        ))}
    </>
  )
}
