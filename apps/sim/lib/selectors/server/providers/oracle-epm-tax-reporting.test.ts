/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  applications: vi.fn(),
  jobs: vi.fn(),
  client: vi.fn(),
  account: vi.fn(),
  token: vi.fn(),
}))
vi.mock('@/lib/internal/oracle-epm-tax-reporting/operations', () => ({
  listTaxApplications: mocks.applications,
  listTaxJobDefinitions: mocks.jobs,
}))
vi.mock('@/lib/internal/oracle-epm-tax-reporting/client', () => ({
  createTaxReportingClient: mocks.client,
}))
vi.mock('@/lib/oauth/credential-service', () => ({ resolveOAuthAccountId: mocks.account }))
vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mocks.token,
}))
vi.mock('@/lib/internal/oracle-epm/files.server', () => ({
  openOracleEpmSourceFile: vi.fn(),
  storeOracleEpmDownload: vi.fn(),
}))

import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { taxReportingSelectorAttachments } from '@/lib/selectors/server/providers/oracle-epm-tax-reporting'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const baseArgs: ExecuteServerSelectorArgs = {
  selectorKey: 'oracle_epm_tax_reporting.applications',
  context: {},
  request: { kind: 'list' },
  scope: { kind: 'workspace', workspaceId: 'workspace' },
  workspaceId: 'workspace',
  principal: { kind: 'session', userId: 'user', sessionId: 'session' },
  requesterUserId: 'user',
  references: new Map(),
  protectedValues: createSelectorProtectedValues(),
}
const destination = { instanceUrl: 'https://epm.example.com/gateway', accessToken: 'trusted-token' }

describe('Tax Reporting selector provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.client.mockReturnValue({ connection: 'prepared-client' })
    mocks.applications.mockResolvedValue({
      items: [{ name: 'TaxB' }, { name: 'TaxA' }, { name: 'TaxA' }],
    })
    mocks.jobs.mockResolvedValue({
      items: [
        { jobName: 'Tax Rule', jobType: 'RULES' },
        { jobName: 'Other Rule', jobType: 'RULESET' },
      ],
    })
  })

  it('projects sorted, deduplicated applications without provider fields or credentials', async () => {
    const result = await taxReportingSelectorAttachments[
      'oracle_epm_tax_reporting.applications'
    ].execute(baseArgs, destination)
    expect(result).toEqual({
      kind: 'list',
      items: [
        { id: 'TaxA', label: 'TaxA' },
        { id: 'TaxB', label: 'TaxB' },
      ],
    })
    expect(mocks.client).toHaveBeenCalledWith(destination)
  })

  it('uses the active application and rule type, and distinguishes definitions from job instances', async () => {
    const result = await taxReportingSelectorAttachments[
      'oracle_epm_tax_reporting.jobDefinitions'
    ].execute(
      {
        ...baseArgs,
        selectorKey: 'oracle_epm_tax_reporting.jobDefinitions',
        context: {
          projectId: 'Tax',
          objectType: 'oracle_epm_tax_reporting_run_rule',
          jobId: 'ignored',
        },
      },
      destination
    )
    expect(mocks.jobs).toHaveBeenCalledWith(
      { connection: 'prepared-client' },
      'Tax',
      'RULES',
      undefined
    )
    expect(result).toMatchObject({
      items: [{ id: 'Tax Rule', label: 'Tax Rule', meta: { detail: 'RULES' } }],
    })
    await expect(
      taxReportingSelectorAttachments['oracle_epm_tax_reporting.jobDefinitions'].execute(
        { ...baseArgs, selectorKey: 'oracle_epm_tax_reporting.jobDefinitions' },
        destination
      )
    ).rejects.toBeInstanceOf(SelectorContextUnavailableError)
  })

  it('resolves selected detail labels only from the bounded listing', async () => {
    const result = await taxReportingSelectorAttachments[
      'oracle_epm_tax_reporting.applications'
    ].execute({ ...baseArgs, request: { kind: 'detail', id: 'Missing' } }, destination)
    expect(result).toEqual({ kind: 'detail', item: null })
  })

  it('requires an authorized Oracle EPM service account before credential resolution', async () => {
    const attachment = taxReportingSelectorAttachments['oracle_epm_tax_reporting.applications']
    await expect(attachment.execute(baseArgs)).rejects.toBeInstanceOf(
      SelectorConnectionUnavailableError
    )
    expect(mocks.token).not.toHaveBeenCalled()
    expect(mocks.applications).not.toHaveBeenCalled()
  })

  it('does not expose provider error text through selector failures', async () => {
    mocks.applications.mockRejectedValue(new Error('tenant-token-canary'))
    await expect(
      taxReportingSelectorAttachments['oracle_epm_tax_reporting.applications'].execute(
        baseArgs,
        destination
      )
    ).rejects.toBeInstanceOf(SelectorOptionsUnavailableError)
  })
})
