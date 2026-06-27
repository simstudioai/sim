'use client'

import { useCallback, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useQueryStates } from 'nuqs'
import { Badge, Button, ChipInput, ChipSelect, Label, Skeleton } from '@/components/emcn'
import { AnthropicIcon, OpenAIIcon } from '@/components/icons'
import { cn } from '@/lib/core/utils/cn'
import {
  BYOKKeyManager,
  type BYOKManagerProvider,
} from '@/app/workspace/[workspaceId]/settings/components/byok/byok-key-manager'
import {
  type MothershipTab,
  mothershipParsers,
  mothershipUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/components/mothership/search-params'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  type MothershipByokKey,
  type MothershipEnv,
  useDeleteMothershipByok,
  useGenerateLicense,
  useMothershipByokKeys,
  useMothershipLicenses,
  useMothershipRequests,
  useMothershipUserBreakdown,
  useUpsertMothershipByok,
} from '@/hooks/queries/mothership-admin'

const ENTERPRISE_BYOK_PROVIDERS: BYOKManagerProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    icon: OpenAIIcon,
    description: 'Enterprise mothership LLM calls',
    placeholder: 'sk-...',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    icon: AnthropicIcon,
    description: 'Enterprise mothership LLM calls',
    placeholder: 'sk-ant-...',
  },
]

const TABS: { id: MothershipTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'licenses', label: 'Licenses' },
  { id: 'byok', label: 'BYOK' },
]

const ENV_OPTIONS: { value: MothershipEnv; label: string }[] = [
  { value: 'dev', label: 'Dev' },
  { value: 'staging', label: 'Staging' },
  { value: 'prod', label: 'Prod' },
]

function defaultTimeRange() {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 7)
  return {
    start: start.toISOString().slice(0, 16),
    end: end.toISOString().slice(0, 16),
  }
}

function toRFC3339(local: string) {
  if (!local) return ''
  return new Date(local).toISOString()
}

function formatCost(cost: number) {
  return `$${cost.toFixed(4)}`
}

function formatDate(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleString()
}

function Divider() {
  return <div className='h-px bg-[var(--border)]' />
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className='font-medium text-[var(--text-muted)] text-small'>{children}</p>
}

export function Mothership() {
  const t = useTranslations('auto')
  const [{ tab: activeTab, env: environment }, setMothershipParams] = useQueryStates(
    mothershipParsers,
    mothershipUrlKeys
  )
  const defaults = useMemo(() => defaultTimeRange(), [])
  const [start, setStart] = useState(defaults.start)
  const [end, setEnd] = useState(defaults.end)

  return (
    <SettingsPanel>
      <div className='flex flex-col gap-6'>
        <div className='flex items-center gap-2'>
          <Label className='text-[var(--text-secondary)] text-sm'>{t('environment')}</Label>
          <ChipSelect
            align='start'
            dropdownWidth={160}
            value={environment}
            onChange={(value) => setMothershipParams({ env: value as MothershipEnv })}
            placeholder={t('select_environment')}
            options={ENV_OPTIONS}
          />
        </div>

        <div className='flex gap-1 border-[var(--border-secondary)] border-b pb-px'>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type='button'
              onClick={() => setMothershipParams({ tab: tab.id })}
              className={cn(
                'relative px-3 py-2 font-medium text-sm transition-colors',
                activeTab === tab.id
                  ? 'text-[var(--text-primary)]'
                  : 'text-[var(--text-tertiary)] hover-hover:hover:text-[var(--text-secondary)]'
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <span className='absolute right-0 bottom-0 left-0 h-[2px] bg-[var(--text-primary)]' />
              )}
            </button>
          ))}
        </div>

        <div className='flex items-center gap-3'>
          <div className='flex items-center gap-2'>
            <Label className='text-[var(--text-secondary)] text-caption'>{t('from')}</Label>
            <ChipInput
              type='datetime-local'
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div className='flex items-center gap-2'>
            <Label className='text-[var(--text-secondary)] text-caption'>{t('to')}</Label>
            <ChipInput type='datetime-local' value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>

        <Divider />

        {activeTab === 'overview' && (
          <OverviewTab environment={environment} start={toRFC3339(start)} end={toRFC3339(end)} />
        )}
        {activeTab === 'licenses' && <LicensesTab environment={environment} />}
        {activeTab === 'byok' && <ByokTab />}
      </div>
    </SettingsPanel>
  )
}

function ByokTab() {
  const t = useTranslations('auto')
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''

  const { data, isLoading } = useMothershipByokKeys(workspaceId)
  const upsert = useUpsertMothershipByok()
  const del = useDeleteMothershipByok()

  const configuredProviderIds = useMemo(
    () => new Set(((data?.keys as MothershipByokKey[]) ?? []).map((k) => k.provider)),
    [data]
  )

  return (
    <BYOKKeyManager
      providers={ENTERPRISE_BYOK_PROVIDERS}
      configuredProviderIds={configuredProviderIds}
      isLoading={isLoading}
      isSaving={upsert.isPending}
      isDeleting={del.isPending}
      showSearch={false}
      description={t('store_a_customer_provided_anthropic_or')}
      onSave={async (provider, apiKey) => {
        await upsert.mutateAsync({ workspaceId, provider, apiKey })
      }}
      onDelete={async (provider) => {
        await del.mutateAsync({ workspaceId, provider })
      }}
    />
  )
}

function OverviewTab({
  environment,
  start,
  end,
}: {
  environment: MothershipEnv
  start: string
  end: string
}) {
  const t = useTranslations('auto')
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

  return (
    <div className='flex flex-col gap-5'>
      <div className='grid grid-cols-4 gap-3'>
        <StatCard
          label={t('total_requests')}
          value={breakdown?.total_requests}
          loading={breakdownLoading}
        />
        <StatCard
          label={t('unique_users')}
          value={breakdown?.total_users}
          loading={breakdownLoading}
        />
        <StatCard
          label={t('total_cost')}
          value={
            breakdown?.users
              ? formatCost(
                  breakdown.users.reduce(
                    (s: number, u: { total_cost: number }) => s + u.total_cost,
                    0
                  )
                )
              : undefined
          }
          loading={breakdownLoading}
        />
        <StatCard
          label={t('avg_cost_request')}
          value={
            breakdown?.total_requests && breakdown.users
              ? formatCost(
                  breakdown.users.reduce(
                    (s: number, u: { total_cost: number }) => s + u.total_cost,
                    0
                  ) / breakdown.total_requests
                )
              : undefined
          }
          loading={breakdownLoading}
        />
      </div>

      <SectionLabel>{t('user_breakdown')}</SectionLabel>
      {breakdownLoading && (
        <div className='flex flex-col gap-2'>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className='h-[36px] w-full rounded-md' />
          ))}
        </div>
      )}
      {breakdown?.users && (
        <div className='flex flex-col gap-0.5'>
          <div className='flex items-center gap-3 border-[var(--border-secondary)] border-b px-3 py-2 text-[var(--text-tertiary)] text-caption'>
            <span className='flex-1'>{t('user_id')}</span>
            <span className='w-[100px] text-right'>{t('requests')}</span>
            <span className='w-[100px] text-right'>{t('cost')}</span>
            <span className='w-[160px] text-right'>{t('last_request')}</span>
          </div>
          {breakdown.users.map(
            (u: {
              user_id: string
              request_count: number
              total_cost: number
              last_request: string
            }) => (
              <div
                key={u.user_id}
                className='flex items-center gap-3 border-[var(--border-secondary)] border-b px-3 py-2 text-small last:border-b-0'
              >
                <span className='flex-1 truncate font-mono text-[12px] text-[var(--text-primary)]'>
                  {u.user_id}
                </span>
                <span className='w-[100px] text-right text-[var(--text-secondary)]'>
                  {u.request_count}
                </span>
                <span className='w-[100px] text-right text-[var(--text-secondary)]'>
                  {formatCost(u.total_cost)}
                </span>
                <span className='w-[160px] text-right text-[var(--text-tertiary)] text-caption'>
                  {formatDate(u.last_request)}
                </span>
              </div>
            )
          )}
        </div>
      )}

      <Divider />
      <SectionLabel>
        {t('recent_requests')}
        {requests?.count ?? '…'})
      </SectionLabel>
      {requestsLoading && (
        <div className='flex flex-col gap-2'>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className='h-[36px] w-full rounded-md' />
          ))}
        </div>
      )}
      {requests?.requests && (
        <div className='max-h-[400px] overflow-auto'>
          <div className='flex flex-col gap-0.5'>
            <div className='sticky top-0 z-10 flex items-center gap-3 border-[var(--border-secondary)] border-b bg-[var(--surface-1)] px-3 py-2 text-[var(--text-tertiary)] text-caption'>
              <span className='w-[180px]'>{t('request_id')}</span>
              <span className='w-[80px]'>{t('model')}</span>
              <span className='w-[80px] text-right'>{t('duration')}</span>
              <span className='w-[80px] text-right'>{t('cost')}</span>
              <span className='w-[60px] text-right'>{t('tools')}</span>
              <span className='w-[70px] text-right'>{t('status')}</span>
              <span className='flex-1 text-right'>{t('time')}</span>
            </div>
            {requests.requests
              .slice(0, 100)
              .map(
                (r: {
                  request_id: string
                  model: string
                  duration_ms: number
                  billed_total_cost: number
                  tool_call_count: number
                  error: boolean
                  aborted: boolean
                  created_at: string
                }) => (
                  <div
                    key={r.request_id}
                    className='flex items-center gap-3 border-[var(--border-secondary)] border-b px-3 py-1.5 text-small last:border-b-0'
                  >
                    <span className='w-[180px] truncate font-mono text-[11px] text-[var(--text-primary)]'>
                      {r.request_id ?? '—'}
                    </span>
                    <span className='w-[80px] truncate text-[var(--text-secondary)] text-caption'>
                      {(r.model ?? '').replace('claude-', '')}
                    </span>
                    <span className='w-[80px] text-right text-[var(--text-secondary)] text-caption'>
                      {r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}
                    </span>
                    <span className='w-[80px] text-right text-[var(--text-secondary)] text-caption'>
                      {formatCost(r.billed_total_cost ?? 0)}
                    </span>
                    <span className='w-[60px] text-right text-[var(--text-secondary)] text-caption'>
                      {r.tool_call_count ?? 0}
                    </span>
                    <span className='w-[70px] text-right'>
                      {r.error ? (
                        <Badge variant='red'>{t('error')}</Badge>
                      ) : r.aborted ? (
                        <Badge variant='amber'>{t('abort')}</Badge>
                      ) : (
                        <Badge variant='green'>OK</Badge>
                      )}
                    </span>
                    <span className='flex-1 text-right text-[var(--text-tertiary)] text-caption'>
                      {formatDate(r.created_at)}
                    </span>
                  </div>
                )
              )}
          </div>
        </div>
      )}
    </div>
  )
}

function LicensesTab({ environment }: { environment: MothershipEnv }) {
  const t = useTranslations('auto')
  const { data, isLoading, refetch } = useMothershipLicenses(environment)
  const generateLicense = useGenerateLicense(environment)
  const [newName, setNewName] = useState('')
  const [newExpiry, setNewExpiry] = useState('')
  const [generatedKey, setGeneratedKey] = useState<string | null>(null)

  const handleGenerate = useCallback(() => {
    if (!newName.trim()) return
    generateLicense.mutate(
      {
        name: newName.trim(),
        ...(newExpiry ? { expirationDate: newExpiry } : {}),
      },
      {
        onSuccess: (result) => {
          setGeneratedKey(result.license_key)
          setNewName('')
          setNewExpiry('')
          refetch()
        },
      }
    )
  }, [newName, newExpiry, generateLicense, refetch])

  return (
    <div className='flex flex-col gap-5'>
      <SectionLabel>{t('generate_license')}</SectionLabel>
      <div className='flex items-end gap-2'>
        <div className='flex flex-col gap-1'>
          <Label className='text-[var(--text-secondary)] text-caption'>
            {t('enterprise_name')}
          </Label>
          <ChipInput
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value)
              setGeneratedKey(null)
            }}
            placeholder={t('e_g_acme_corp')}
            className='w-[200px]'
          />
        </div>
        <div className='flex flex-col gap-1'>
          <Label className='text-[var(--text-secondary)] text-caption'>
            {t('expiration_optional')}
          </Label>
          <ChipInput
            type='date'
            value={newExpiry}
            onChange={(e) => setNewExpiry(e.target.value)}
            className='w-[160px]'
          />
        </div>
        <Button
          variant='primary'
          className='h-[32px]'
          onClick={handleGenerate}
          disabled={generateLicense.isPending || !newName.trim()}
        >
          {generateLicense.isPending ? 'Generating...' : 'Generate'}
        </Button>
      </div>

      {generatedKey && (
        <div className='rounded-md border border-[var(--border-secondary)] bg-[var(--surface-hover)] p-3'>
          <p className='mb-1 text-[var(--text-secondary)] text-caption'>
            {t('license_key_only_shown_once')}
          </p>
          <code className='block break-all font-mono text-[12px] text-[var(--text-primary)]'>
            {generatedKey}
          </code>
        </div>
      )}

      {generateLicense.error && (
        <p className='text-[var(--text-error)] text-small'>{generateLicense.error.message}</p>
      )}

      <Divider />
      <SectionLabel>{t('all_licenses')}</SectionLabel>

      {isLoading && (
        <div className='flex flex-col gap-2'>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className='h-[40px] w-full rounded-md' />
          ))}
        </div>
      )}

      {data?.licenses && (
        <div className='flex flex-col gap-0.5'>
          <div className='flex items-center gap-3 border-[var(--border-secondary)] border-b px-3 py-2 text-[var(--text-tertiary)] text-caption'>
            <span className='flex-1'>{t('name')}</span>
            <span className='w-[100px] text-right'>{t('validations')}</span>
            <span className='w-[140px] text-right'>{t('expiration')}</span>
            <span className='w-[140px] text-right'>{t('created')}</span>
          </div>
          {data.licenses.length === 0 && (
            <SettingsEmptyState variant='inline'>{t('no_licenses_found')}</SettingsEmptyState>
          )}
          {data.licenses.map(
            (lic: {
              id: string
              name: string
              count: number
              expiration_date?: string
              created_at: string
            }) => (
              <div
                key={lic.id}
                className='flex items-center gap-3 border-[var(--border-secondary)] border-b px-3 py-2 text-small last:border-b-0'
              >
                <span className='flex-1 text-[var(--text-primary)]'>{lic.name}</span>
                <span className='w-[100px] text-right text-[var(--text-secondary)]'>
                  {lic.count}
                </span>
                <span className='w-[140px] text-right text-[var(--text-tertiary)] text-caption'>
                  {lic.expiration_date ? formatDate(lic.expiration_date) : 'Never'}
                </span>
                <span className='w-[140px] text-right text-[var(--text-tertiary)] text-caption'>
                  {formatDate(lic.created_at)}
                </span>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  loading,
}: {
  label: string
  value?: string | number
  loading?: boolean
}) {
  return (
    <div className='rounded-md border border-[var(--border-secondary)] p-3'>
      <p className='text-[var(--text-tertiary)] text-caption'>{label}</p>
      {loading ? (
        <Skeleton className='mt-1 h-[24px] w-[80px] rounded-sm' />
      ) : (
        <p className='mt-1 font-medium text-[18px] text-[var(--text-primary)]'>{value ?? '—'}</p>
      )}
    </div>
  )
}
