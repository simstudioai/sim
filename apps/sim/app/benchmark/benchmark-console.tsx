'use client'

import { useState } from 'react'
import { Chip, ChipCombobox, ChipLink } from '@sim/emcn'
import { useQueryStates } from 'nuqs'
import {
  benchmarkConsoleParams,
  benchmarkConsoleUrlOptions,
  emptyBenchmarkSelection,
} from '@/app/benchmark/search-params'
import { Benchmark } from '@/app/o/[organizationId]/benchmark/benchmark'
import {
  useBenchmarkOrganizations,
  useBenchmarkUsers,
  useBenchmarkWorkspaces,
} from '@/hooks/queries/benchmarks'
import { useDebounce } from '@/hooks/use-debounce'

export function BenchmarkConsole() {
  const [{ organizationId, runAsUserId }, setParams] = useQueryStates(
    benchmarkConsoleParams,
    benchmarkConsoleUrlOptions
  )
  const [organizationSearch, setOrganizationSearch] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const organizations = useBenchmarkOrganizations(
    useDebounce(organizationSearch, 250),
    organizationId
  )
  const users = useBenchmarkUsers(organizationId, useDebounce(userSearch, 250), runAsUserId)
  const workspaces = useBenchmarkWorkspaces(organizationId, runAsUserId)
  const selectedOrganization = organizations.data?.pages[0]?.selected
  const organizationOptions = [
    ...(selectedOrganization ? [selectedOrganization] : []),
    ...(organizations.data?.pages
      .flatMap((page) => page.organizations)
      .filter((org) => org.id !== selectedOrganization?.id) ?? []),
  ]
  const selectedUser = users.data?.pages[0]?.selected
  const userOptions = [
    ...(selectedUser ? [selectedUser] : []),
    ...(users.data?.pages
      .flatMap((page) => page.users)
      .filter((user) => user.id !== selectedUser?.id) ?? []),
  ]
  const error = organizations.error ?? users.error ?? workspaces.error

  return (
    <main className='workspace-root min-h-screen bg-[var(--bg)] text-[var(--text-body)]'>
      <div className='mx-auto flex w-full max-w-chat flex-col gap-5 px-6 pt-8'>
        <div className='flex items-center justify-between gap-4'>
          <h1 className='text-[var(--text-primary)] text-lg'>Benchmarks</h1>
          <ChipLink href='/account/settings/admin'>Back to settings</ChipLink>
        </div>
        <p className='text-[var(--text-muted)] text-small'>
          Run a benchmark with a user’s enterprise access. Your admin session stays unchanged.
        </p>
        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='flex flex-col gap-2'>
            <label htmlFor='benchmark-organization' className='text-small'>
              Organization
            </label>
            <ChipCombobox
              id='benchmark-organization'
              aria-label='Organization'
              value={organizationId}
              options={organizationOptions.map((org) => ({ value: org.id, label: org.name }))}
              placeholder='Select an organization'
              searchable
              isLoading={organizations.isLoading}
              onSearchChange={setOrganizationSearch}
              onChange={(value) =>
                setParams({ organizationId: value, runAsUserId: null, ...emptyBenchmarkSelection })
              }
            />
            {organizations.hasNextPage && (
              <Chip
                disabled={organizations.isFetchingNextPage}
                onClick={() => organizations.fetchNextPage()}
              >
                Load more organizations
              </Chip>
            )}
          </div>
          <div className='flex flex-col gap-2'>
            <label htmlFor='benchmark-user' className='text-small'>
              Run as user
            </label>
            <ChipCombobox
              key={organizationId}
              id='benchmark-user'
              aria-label='Run as user'
              value={runAsUserId}
              options={userOptions.map((user) => ({
                value: user.id,
                label: `${user.name} (${user.email})`,
              }))}
              placeholder='Select a user'
              searchable
              isLoading={users.isLoading}
              disabled={!organizationId}
              onSearchChange={setUserSearch}
              onChange={(value) => setParams({ runAsUserId: value, ...emptyBenchmarkSelection })}
            />
            {users.hasNextPage && (
              <Chip disabled={users.isFetchingNextPage} onClick={() => users.fetchNextPage()}>
                Load more users
              </Chip>
            )}
          </div>
        </div>
        {runAsUserId && (
          <p className='text-[var(--text-muted)] text-small'>
            Running as {selectedUser?.email ?? runAsUserId}. Normal permissions and billing for this
            organization apply. Reports are private to you.
          </p>
        )}
        {error && (
          <p role='alert' className='text-[var(--text-error)] text-small'>
            {error.message}
          </p>
        )}
      </div>
      {organizationId && runAsUserId && workspaces.data && !workspaces.error && (
        <Benchmark
          key={`${organizationId}:${runAsUserId}`}
          organizationId={organizationId}
          runAsUserId={runAsUserId}
          canPlan={workspaces.data.pages[0]?.canPlan ?? false}
        />
      )}
    </main>
  )
}
