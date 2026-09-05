import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { selectorManifest } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { oracleFusionHcmSelectorAttachments } from '@/lib/selectors/server/providers/oracle-fusion-hcm'
import type {
  ExecuteServerSelectorArgs,
  ServerSelectorAttachment,
} from '@/lib/selectors/server/types'

const TEST_ACCESS_TOKEN = 'test-access-token'

const mocks = vi.hoisted(() => ({
  resolveCredentialBundle: vi.fn(),
  listWorkers: vi.fn(),
  getWorker: vi.fn(),
  listAssignments: vi.fn(),
  getAssignment: vi.fn(),
  listAbsences: vi.fn(),
  getAbsence: vi.fn(),
  listAbsenceTypes: vi.fn(),
}))
vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mocks.resolveCredentialBundle,
}))
vi.mock('@/lib/internal/oracle-fusion-hcm/operations', () => ({
  executeOracleFusionHcmListWorkers: mocks.listWorkers,
  executeOracleFusionHcmGetWorker: mocks.getWorker,
  executeOracleFusionHcmListWorkerAssignments: mocks.listAssignments,
  executeOracleFusionHcmGetWorkerAssignment: mocks.getAssignment,
  executeOracleFusionHcmListAbsences: mocks.listAbsences,
  executeOracleFusionHcmGetAbsence: mocks.getAbsence,
  executeOracleFusionHcmListAbsenceTypes: mocks.listAbsenceTypes,
}))

const protectedValues = {
  add: vi.fn(),
  contains: vi.fn(),
  containsExceptExact: vi.fn(),
} as never

function args(overrides: Partial<ExecuteServerSelectorArgs> = {}): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'oracle_fusion_hcm.workers',
    context: { oauthCredential: 'credential-id' },
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'ws' },
    workspaceId: 'ws',
    principal: {} as never,
    requesterUserId: 'user',
    credential: {
      suppliedId: 'credential-id',
      access: {
        resolvedCredentialId: 'credential-id',
        credentialType: 'service_account',
        credentialOwnerUserId: 'owner',
      } as never,
    },
    references: new Map(),
    protectedValues,
    ...overrides,
  }
}

async function prepare(attachment: ServerSelectorAttachment, input: ExecuteServerSelectorArgs) {
  if (attachment.destination === 'fixed') throw new Error('expected prepared destination')
  return attachment.destination.prepare(input)
}

describe('Oracle Fusion HCM selectors', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.resolveCredentialBundle.mockResolvedValue({
      accessToken: TEST_ACCESS_TOKEN,
      instanceUrl: 'https://acme.fa.ocs.oraclecloud.com/',
    })
    mocks.listWorkers.mockResolvedValue({
      success: true,
      output: {
        workers: [
          { personId: '1', personNumber: 'P1', displayName: 'Ada', workEmail: 'ada@example.com' },
        ],
        count: 1,
        hasMore: true,
        limit: 7,
        offset: 50,
        nextOffset: 51,
      },
    })
    mocks.getWorker.mockResolvedValue({
      success: true,
      output: {
        worker: {
          personId: '1',
          personNumber: 'P1',
          displayName: 'Ada',
          workEmail: 'ada@example.com',
        },
      },
    })
    mocks.listAssignments.mockResolvedValue({
      success: true,
      output: {
        assignments: [{ assignmentId: '2', assignmentName: 'Engineering', assignmentNumber: 'A2' }],
        count: 1,
        hasMore: false,
        limit: 50,
        offset: 0,
      },
    })
    mocks.getAssignment.mockResolvedValue({
      success: true,
      output: {
        assignment: {
          assignmentId: '2',
          assignmentName: 'Engineering',
          assignmentNumber: 'A2',
        },
      },
    })
    mocks.listAbsences.mockResolvedValue({
      success: true,
      output: {
        absences: [
          {
            absenceId: '3',
            personId: '1',
            absenceType: 'Vacation',
            startDate: '2026-01-01',
            endDate: '2026-01-02',
            displayStatusMeaning: 'Approved',
          },
        ],
        count: 1,
        hasMore: false,
        limit: 50,
        offset: 0,
      },
    })
    mocks.getAbsence.mockResolvedValue({
      success: true,
      output: {
        absence: {
          absenceId: '3',
          personId: '1',
          absenceType: 'Vacation',
          startDate: '2026-01-01',
          endDate: '2026-01-02',
          displayStatusMeaning: 'Approved',
        },
      },
    })
    mocks.listAbsenceTypes.mockResolvedValue({
      success: true,
      output: {
        absenceTypes: [
          {
            absenceTypeId: '4',
            name: 'Vacation',
            nameWithEmployer: 'Vacation - Acme',
            employerName: 'Acme',
          },
        ],
        count: 1,
        hasMore: false,
        limit: 50,
        offset: 0,
      },
    })
  })

  it('declares stored credential-bound, integration-gated, uncached selectors', () => {
    for (const key of ['workers', 'assignments', 'absences', 'absenceTypes'] as const) {
      const manifest = selectorManifest[`oracle_fusion_hcm.${key}`]
      const attachment = oracleFusionHcmSelectorAttachments[`oracle_fusion_hcm.${key}`]
      expect(manifest).toMatchObject({ classification: 'provider-server', staleTime: 0 })
      expect(manifest.context.allowed).not.toContain('username')
      expect(manifest.context.allowed).not.toContain('password')
      expect(manifest.context.allowed).not.toContain('domain')
      expect(attachment).toMatchObject({
        credential: {
          kind: 'stored',
          field: 'oauthCredential',
          serviceIds: ['oracle_fusion_hcm'],
        },
        integrationBlockTypes: ['oracle_fusion_hcm'],
        destination: { kind: 'credential-bound' },
      })
    }
  })

  it('resolves only the expected foundation service account and protects the bundle', async () => {
    const recordCredentialUse = vi.fn()
    const attachment = oracleFusionHcmSelectorAttachments['oracle_fusion_hcm.assignments']
    const input = args({
      context: { oauthCredential: 'credential-id', personId: '1' },
      recordCredentialUse,
    })
    const prepared = await prepare(attachment, input)
    expect(prepared).toEqual({
      instanceUrl: 'https://acme.fa.ocs.oraclecloud.com',
      accessToken: TEST_ACCESS_TOKEN,
      personId: '1',
    })
    expect(mocks.resolveCredentialBundle).toHaveBeenCalledWith({
      credential: input.credential,
      protectedValues,
      recordCredentialUse,
      providerId: 'oracle-fusion-service-account',
    })
    expect(JSON.stringify(input.context)).not.toContain('cmVhZGVy')
    expect(JSON.stringify(input.context)).not.toContain('oraclecloud.com')
  })

  it('maps credential lookup failures safely and honors an already-aborted preparation', async () => {
    const attachment = oracleFusionHcmSelectorAttachments['oracle_fusion_hcm.workers']
    mocks.resolveCredentialBundle.mockRejectedValueOnce(new SelectorConnectionUnavailableError())
    await expect(prepare(attachment, args())).rejects.toBeInstanceOf(
      SelectorConnectionUnavailableError
    )

    const controller = new AbortController()
    controller.abort(new Error('preparation stopped'))
    await expect(prepare(attachment, args({ signal: controller.signal }))).rejects.toThrow(
      'preparation stopped'
    )
    expect(mocks.resolveCredentialBundle).toHaveBeenCalledTimes(1)
  })

  it('rejects missing and malformed authoritative destinations', async () => {
    const attachment = oracleFusionHcmSelectorAttachments['oracle_fusion_hcm.workers']
    for (const instanceUrl of [undefined, 'https://evil.example.com/path']) {
      mocks.resolveCredentialBundle.mockResolvedValueOnce({
        accessToken: TEST_ACCESS_TOKEN,
        instanceUrl,
      })
      await expect(prepare(attachment, args())).rejects.toBeInstanceOf(
        SelectorConnectionUnavailableError
      )
    }
  })

  it('uses Oracle nextOffset for bounded worker pagination', async () => {
    const attachment = oracleFusionHcmSelectorAttachments['oracle_fusion_hcm.workers']
    const input = args({ request: { kind: 'list', search: 'Ada', cursor: '50' } })
    const result = await attachment.execute(input, await prepare(attachment, input))
    expect(mocks.listWorkers).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceUrl: 'https://acme.fa.ocs.oraclecloud.com',
        accessToken: TEST_ACCESS_TOKEN,
        search: 'Ada',
        limit: 50,
        offset: 50,
      }),
      undefined
    )
    expect(result).toEqual({
      kind: 'list',
      items: [
        { id: '1', label: 'Ada', meta: { personNumber: 'P1', workEmail: 'ada@example.com' } },
      ],
      nextCursor: '51',
    })
    expect(JSON.stringify(result)).not.toContain('cmVhZGVy')
  })

  it('rejects hasMore without a shared-protocol nextOffset', async () => {
    mocks.listWorkers.mockResolvedValueOnce({
      success: true,
      output: { workers: [], count: 0, hasMore: true, limit: 50, offset: 0 },
    })
    const attachment = oracleFusionHcmSelectorAttachments['oracle_fusion_hcm.workers']
    const input = args()
    await expect(
      attachment.execute(input, await prepare(attachment, input))
    ).rejects.toBeInstanceOf(SelectorOptionsUnavailableError)
  })

  it('projects dependent lists using only validated person context', async () => {
    for (const key of ['assignments', 'absences', 'absenceTypes'] as const) {
      const attachment = oracleFusionHcmSelectorAttachments[`oracle_fusion_hcm.${key}`]
      const input = args({
        selectorKey: `oracle_fusion_hcm.${key}`,
        context: { oauthCredential: 'credential-id', personId: '1' },
      })
      const result = await attachment.execute(input, await prepare(attachment, input))
      expect(result.kind).toBe('list')
      if (result.kind === 'list') expect(result.items).toHaveLength(1)
    }
    for (const mock of [mocks.listAssignments, mocks.listAbsences, mocks.listAbsenceTypes]) {
      expect(mock).toHaveBeenCalledWith(expect.objectContaining({ personId: '1' }), undefined)
    }
  })

  it('supports exact worker, assignment, and owned absence details', async () => {
    for (const key of ['workers', 'assignments', 'absences'] as const) {
      const id = key === 'workers' ? '1' : key === 'assignments' ? '2' : '3'
      const attachment = oracleFusionHcmSelectorAttachments[`oracle_fusion_hcm.${key}`]
      const input = args({
        selectorKey: `oracle_fusion_hcm.${key}`,
        context: { oauthCredential: 'credential-id', personId: '1' },
        request: { kind: 'detail', id },
      })
      const result = await attachment.execute(input, await prepare(attachment, input))
      expect(result.kind).toBe('detail')
      if (result.kind === 'detail') expect(result.item?.id).toBe(id)
    }
  })

  it('rejects mismatched detail IDs and absence ownership', async () => {
    for (const [key, id, mock, output, ErrorClass] of [
      [
        'workers',
        '1',
        mocks.getWorker,
        { worker: { personId: '9' } },
        SelectorOptionsUnavailableError,
      ],
      [
        'assignments',
        '2',
        mocks.getAssignment,
        { assignment: { assignmentId: '9' } },
        SelectorOptionsUnavailableError,
      ],
      [
        'absences',
        '3',
        mocks.getAbsence,
        { absence: { absenceId: '3', personId: '2' } },
        SelectorContextUnavailableError,
      ],
    ] as const) {
      mock.mockResolvedValueOnce({ success: true, output })
      const attachment = oracleFusionHcmSelectorAttachments[`oracle_fusion_hcm.${key}`]
      const input = args({
        selectorKey: `oracle_fusion_hcm.${key}`,
        context: { oauthCredential: 'credential-id', personId: '1' },
        request: { kind: 'detail', id },
      })
      await expect(
        attachment.execute(input, await prepare(attachment, input))
      ).rejects.toBeInstanceOf(ErrorClass)
    }
  })

  it.each([undefined, '2'])('rejects a listed absence with personId %s', async (personId) => {
    mocks.listAbsences.mockResolvedValueOnce({
      success: true,
      output: {
        absences: [{ absenceId: '3', personId, absenceType: 'Vacation' }],
        count: 1,
        hasMore: false,
        limit: 50,
        offset: 0,
      },
    })
    const attachment = oracleFusionHcmSelectorAttachments['oracle_fusion_hcm.absences']
    const input = args({
      selectorKey: 'oracle_fusion_hcm.absences',
      context: { oauthCredential: 'credential-id', personId: '1' },
    })
    await expect(
      attachment.execute(input, await prepare(attachment, input))
    ).rejects.toBeInstanceOf(SelectorContextUnavailableError)
  })

  it('returns safe missing details and maps provider statuses', async () => {
    const context = { oauthCredential: 'credential-id', personId: '1' }
    for (const [key, id, mock] of [
      ['workers', '1', mocks.getWorker],
      ['assignments', '2', mocks.getAssignment],
      ['absences', '3', mocks.getAbsence],
    ] as const) {
      mock.mockRejectedValueOnce(new OracleFusionProviderError('not found detail', 404))
      const attachment = oracleFusionHcmSelectorAttachments[`oracle_fusion_hcm.${key}`]
      const input = args({
        selectorKey: `oracle_fusion_hcm.${key}`,
        context,
        request: { kind: 'detail', id },
      })
      await expect(attachment.execute(input, await prepare(attachment, input))).resolves.toEqual({
        kind: 'detail',
        item: null,
      })
    }

    for (const [status, ErrorClass] of [
      [401, SelectorConnectionUnavailableError],
      [429, SelectorOptionsUnavailableError],
      [500, SelectorOptionsUnavailableError],
    ] as const) {
      mocks.listWorkers.mockRejectedValueOnce(
        new OracleFusionProviderError('private detail', status)
      )
      const attachment = oracleFusionHcmSelectorAttachments['oracle_fusion_hcm.workers']
      const input = args()
      await expect(
        attachment.execute(input, await prepare(attachment, input))
      ).rejects.toBeInstanceOf(ErrorClass)
    }
  })

  it('maps unexpected failures to a non-reflective options error', async () => {
    mocks.listWorkers.mockRejectedValueOnce(new Error('secret internal failure'))
    const attachment = oracleFusionHcmSelectorAttachments['oracle_fusion_hcm.workers']
    const input = args()
    await expect(attachment.execute(input, await prepare(attachment, input))).rejects.toMatchObject(
      {
        status: 502,
      }
    )
  })

  it.each(['../workers/1', '1,absenceTypeId=2', '0', '9223372036854775808'])(
    'rejects invalid dependent person ID %s before secret resolution',
    async (personId) => {
      const attachment = oracleFusionHcmSelectorAttachments['oracle_fusion_hcm.assignments']
      await expect(
        prepare(
          attachment,
          args({
            selectorKey: 'oracle_fusion_hcm.assignments',
            context: { oauthCredential: 'credential-id', personId },
          })
        )
      ).rejects.toBeInstanceOf(SelectorContextUnavailableError)
      expect(mocks.listAssignments).not.toHaveBeenCalled()
    }
  )

  it('rejects invalid cursors and missing person context', async () => {
    const attachment = oracleFusionHcmSelectorAttachments['oracle_fusion_hcm.assignments']
    const noPerson = args()
    await expect(
      attachment.execute(noPerson, await prepare(attachment, noPerson))
    ).rejects.toBeInstanceOf(SelectorContextUnavailableError)

    const invalidCursor = args({
      context: { oauthCredential: 'credential-id', personId: '1' },
      request: { kind: 'list', cursor: '-1' },
    })
    await expect(
      attachment.execute(invalidCursor, await prepare(attachment, invalidCursor))
    ).rejects.toBeInstanceOf(SelectorContextUnavailableError)
  })

  it('propagates aborts before provider error mapping', async () => {
    const controller = new AbortController()
    mocks.listWorkers.mockImplementationOnce(async () => {
      controller.abort(new Error('selector stopped'))
      throw new Error('private failure')
    })
    const attachment = oracleFusionHcmSelectorAttachments['oracle_fusion_hcm.workers']
    const input = args({ signal: controller.signal })
    await expect(attachment.execute(input, await prepare(attachment, input))).rejects.toThrow(
      'selector stopped'
    )
  })
})
