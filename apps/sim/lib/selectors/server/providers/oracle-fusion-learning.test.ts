/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { selectorManifest } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { oracleFusionLearningSelectorAttachments } from '@/lib/selectors/server/providers/oracle-fusion-learning'
import type {
  ExecuteServerSelectorArgs,
  ServerSelectorAttachment,
} from '@/lib/selectors/server/types'

const mocks = vi.hoisted(() => ({
  credential: vi.fn(),
  executeListSelfPacedItems: vi.fn(),
  executeGetSelfPacedItem: vi.fn(),
  executeListLearningEvents: vi.fn(),
  executeGetLearningEvent: vi.fn(),
  executeListEventActivities: vi.fn(),
  getEventActivityForSelector: vi.fn(),
  executeListLearningRecords: vi.fn(),
  executeGetLearningRecord: vi.fn(),
  executeListSelectedCourseOfferings: vi.fn(),
  getSelectedCourseOfferingForSelector: vi.fn(),
  executeListCompletionDetails: vi.fn(),
  getCompletionDetailForSelector: vi.fn(),
  executeListAssignmentProfiles: vi.fn(),
  executeGetAssignmentProfile: vi.fn(),
}))
vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mocks.credential,
}))
vi.mock('@/lib/internal/oracle-fusion-learning/operations', () => ({
  executeListSelfPacedItems: mocks.executeListSelfPacedItems,
  executeGetSelfPacedItem: mocks.executeGetSelfPacedItem,
  executeListLearningEvents: mocks.executeListLearningEvents,
  executeGetLearningEvent: mocks.executeGetLearningEvent,
  executeListEventActivities: mocks.executeListEventActivities,
  getEventActivityForSelector: mocks.getEventActivityForSelector,
  executeListLearningRecords: mocks.executeListLearningRecords,
  executeGetLearningRecord: mocks.executeGetLearningRecord,
  executeListSelectedCourseOfferings: mocks.executeListSelectedCourseOfferings,
  getSelectedCourseOfferingForSelector: mocks.getSelectedCourseOfferingForSelector,
  executeListCompletionDetails: mocks.executeListCompletionDetails,
  getCompletionDetailForSelector: mocks.getCompletionDetailForSelector,
  executeListAssignmentProfiles: mocks.executeListAssignmentProfiles,
  executeGetAssignmentProfile: mocks.executeGetAssignmentProfile,
}))
const bound = {
  instanceUrl: 'https://acme.fa.ocs.oraclecloud.com',
  accessToken: 'test-access-token',
}
function args(overrides: Partial<ExecuteServerSelectorArgs> = {}): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'oracle_fusion_learning.selfPacedItems',
    context: { oauthCredential: 'credential' },
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace' },
    workspaceId: 'workspace',
    principal: { kind: 'session', userId: 'user', sessionId: 'session' },
    requesterUserId: 'user',
    credential: {
      suppliedId: 'credential',
      access: {
        resolvedCredentialId: 'credential',
        credentialType: 'service_account',
        credentialOwnerUserId: 'owner',
      } as never,
    },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    ...overrides,
  }
}
async function run(attachment: ServerSelectorAttachment, input: ExecuteServerSelectorArgs) {
  if (attachment.destination === 'fixed') throw new Error('Expected credential-bound preparation')
  const prepared = await attachment.destination.prepare(input)
  return attachment.execute(input, prepared)
}

describe('Learning selector permissions and scoping', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.credential.mockResolvedValue(bound)
  })

  it('declares exactly seven Learning-only credential policies and prepared destinations', () => {
    const entries = Object.entries(oracleFusionLearningSelectorAttachments)
    expect(entries).toHaveLength(7)
    for (const [key, attachment] of entries) {
      expect(attachment.credential).toEqual({
        kind: 'stored',
        field: 'oauthCredential',
        serviceIds: ['oracle_fusion_learning'],
      })
      expect(attachment.integrationBlockTypes).toEqual(['oracle_fusion_learning'])
      expect(attachment.destination).toMatchObject({ kind: 'credential-bound' })
      expect(
        selectorManifest[key as keyof typeof oracleFusionLearningSelectorAttachments]
      ).toMatchObject({ listMode: 'paginated', staleTime: 0, supportsDetail: true })
    }
  })

  it('resolves the trusted Fusion provider and returns only safe option fields', async () => {
    mocks.executeListSelfPacedItems.mockResolvedValue({
      output: {
        items: [
          {
            learningItemId: '9007199254740993',
            learningItemTitle: 'Safety',
            learningItemNumber: 'SAF-1',
            UploadAuthToken: 'secret',
          },
        ],
        hasMore: true,
        nextOffset: 51,
      },
    })
    const input = args({ request: { kind: 'list', cursor: '50', search: 'Safety' } })
    const result = await run(
      oracleFusionLearningSelectorAttachments['oracle_fusion_learning.selfPacedItems'],
      input
    )
    expect(mocks.credential).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: input.credential,
        protectedValues: input.protectedValues,
        providerId: 'oracle-fusion-service-account',
      })
    )
    expect(mocks.executeListSelfPacedItems).toHaveBeenCalledWith(
      expect.objectContaining({ ...bound, limit: 50, offset: 50, search: 'Safety' }),
      undefined
    )
    expect(result).toEqual({
      kind: 'list',
      items: [{ id: '9007199254740993', label: 'Safety', meta: { number: 'SAF-1' } }],
      nextCursor: '51',
    })
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('requires parent context and keeps detail resolution under the selected person and assignment', async () => {
    const attachment =
      oracleFusionLearningSelectorAttachments['oracle_fusion_learning.selectedCourseOfferings']
    await expect(run(attachment, args())).rejects.toBeInstanceOf(SelectorContextUnavailableError)
    expect(mocks.getSelectedCourseOfferingForSelector).not.toHaveBeenCalled()
    mocks.getSelectedCourseOfferingForSelector.mockResolvedValue({
      output: {
        item: {
          assignmentRecordId: '3',
          assignmentRecordNumber: 'A3',
          learningItemTitle: 'Morning offering',
        },
      },
    })
    await run(
      attachment,
      args({
        context: { oauthCredential: 'credential', personId: '1', recordId: '2' },
        request: { kind: 'detail', id: '3' },
      })
    )
    expect(mocks.getSelectedCourseOfferingForSelector).toHaveBeenCalledWith(
      expect.objectContaining({ ...bound, personId: '1', recordId: '2', offeringRecordId: '3' }),
      undefined
    )
    expect(
      selectorManifest['oracle_fusion_learning.selectedCourseOfferings'].context.readiness
    ).toEqual({ all: ['oauthCredential', 'personId', 'recordId'] })
  })

  it('rejects mismatched detail IDs and maps missing details to null', async () => {
    const attachment = oracleFusionLearningSelectorAttachments['oracle_fusion_learning.events']
    const input = args({ request: { kind: 'detail', id: '2' } })
    mocks.executeGetLearningEvent.mockResolvedValueOnce({
      output: { item: { learningItemId: '99' } },
    })
    await expect(run(attachment, input)).rejects.toBeInstanceOf(SelectorOptionsUnavailableError)
    mocks.executeGetLearningEvent.mockRejectedValueOnce(
      new OracleFusionProviderError('private', 404)
    )
    expect(await run(attachment, input)).toEqual({ kind: 'detail', item: null })
  })

  it('uses the credential-bound origin and rejects absent credentials or malformed destinations', async () => {
    const attachment = oracleFusionLearningSelectorAttachments['oracle_fusion_learning.events']
    await expect(run(attachment, args({ credential: undefined }))).rejects.toBeInstanceOf(
      SelectorConnectionUnavailableError
    )
    mocks.credential.mockResolvedValue({ ...bound, instanceUrl: 'https://attacker.example.com' })
    await expect(run(attachment, args())).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
    expect(mocks.executeListLearningEvents).not.toHaveBeenCalled()
  })

  it('returns safe permission errors without provider messages', async () => {
    mocks.executeListSelfPacedItems.mockRejectedValue(
      new OracleFusionProviderError('private-secret', 403)
    )
    await expect(
      run(oracleFusionLearningSelectorAttachments['oracle_fusion_learning.selfPacedItems'], args())
    ).rejects.toEqual(new SelectorConnectionUnavailableError(403))
  })

  it('rejects malformed cursors and propagates cancellation', async () => {
    const attachment = oracleFusionLearningSelectorAttachments['oracle_fusion_learning.events']
    await expect(
      run(attachment, args({ request: { kind: 'list', cursor: '-1' } }))
    ).rejects.toBeInstanceOf(SelectorContextUnavailableError)
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(run(attachment, args({ signal: controller.signal }))).rejects.toThrow('cancelled')
    expect(mocks.executeListLearningEvents).not.toHaveBeenCalled()
  })
})
