/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/limits'
import * as schemas from '@/lib/internal/oracle-fusion-learning/schema'

const auth = { instanceUrl: 'https://acme.fa.ocs.oraclecloud.com', accessToken: 'test-access-token' }

describe('Learning request contracts', () => {
  it('keeps int64 IDs lossless and rejects rounded numbers and invalid ranges', () => {
    expect(schemas.decimalIdSchema.parse('9223372036854775807')).toBe('9223372036854775807')
    for (const value of [9007199254740992, '9223372036854775808', '0', '-1', '1e3', '1/child/x']) {
      expect(schemas.decimalIdSchema.safeParse(value).success).toBe(false)
    }
  })

  it('preserves PATCH omission and explicit null without materializing Oracle defaults', () => {
    expect(schemas.recordPatchSchema.parse({ completedDate: null })).toEqual({ completedDate: null })
    expect(schemas.selfPatchSchema.parse({ learningItemDescription: null })).toEqual({ learningItemDescription: null })
    expect(schemas.profilePatchSchema.parse({ completionComments: 'Verified' })).toEqual({ completionComments: 'Verified' })
    expect(schemas.recordPatchSchema.safeParse({ assignmentStatus: null }).success).toBe(false)
    expect(schemas.recordPatchSchema.safeParse({}).success).toBe(false)
  })

  it('rejects creation-only IDs, read-only fields, nested mutations, and upload material', () => {
    for (const body of [{ assignedToId: '1' }, { assignmentRecordId: '2' }, { completionDetails: [] }]) {
      expect(schemas.recordPatchSchema.safeParse(body).success).toBe(false)
    }
    expect(schemas.profilePatchSchema.safeParse({ learningItemId: '3' }).success).toBe(false)
    expect(schemas.contentPatchSchema.safeParse({ UploadAuthToken: 'secret' }).success).toBe(false)
    expect(schemas.contentPostSchema.safeParse({ Title: 'Package', URL: 'https://example.com', TrackingType: 'ORA_SCORM_12' }).success).toBe(false)
    expect(schemas.update_completion_detailSchema.safeParse({
      ...auth, personId: '1', recordId: '2', completionDetailId: '3',
      offeringRecordId: '4', body: { activityAttemptStatus: 'ORA_ASSN_TASK_COMPLETED' },
    }).success).toBe(false)
  })

  it('accepts only the documented scalar completion-detail updates', () => {
    const body = { activityAttemptStatus: 'ORA_ASSN_TASK_COMPLETED', activityAttemptCompletionReasonCode: null }
    expect(schemas.completionPatchSchema.parse(body)).toEqual(body)
    expect(schemas.completionPatchSchema.safeParse({ completedDate: '2026-09-05T00:00:00Z' }).success).toBe(false)
  })

  it('validates calendar dates, timestamp offsets, required authoring fields, and page bounds', () => {
    expect(schemas.dateSchema.safeParse('2026-02-30').success).toBe(false)
    expect(schemas.recordPatchSchema.safeParse({ completedDate: '2026-09-05' }).success).toBe(false)
    expect(schemas.recordPatchSchema.safeParse({ completedDate: '2026-09-05T10:00:00-07:00' }).success).toBe(true)
    expect(schemas.selfPostSchema.safeParse({ learningItemTitle: 'Incomplete draft' }).success).toBe(false)
    expect(schemas.activityPostSchema.safeParse({ activityNumber: 'ACT-1' }).success).toBe(false)
    for (const limit of [0, 101, 1.5]) {
      expect(schemas.list_self_paced_itemsSchema.safeParse({ ...auth, limit }).success).toBe(false)
    }
    expect(schemas.list_self_paced_itemsSchema.parse(auth)).not.toHaveProperty('limit')
  })

  it('rejects oversized serialized bodies before JSON parsing', () => {
    const result = schemas.update_content_itemSchema.safeParse({
      ...auth, contentId: '1', body: ' '.repeat(MAX_INLINE_MATERIALIZATION_BYTES + 1),
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].message).toContain('inline payload limit')
  })

  it('parses JSON bodies while retaining string IDs and rejecting malformed JSON', () => {
    const input = { ...auth, personId: '1', body: '{"learningItemId":"9007199254740993"}' }
    expect(schemas.create_learning_recordSchema.parse(input).body.learningItemId).toBe('9007199254740993')
    expect(schemas.create_learning_recordSchema.safeParse({ ...input, body: '{' }).success).toBe(false)
    expect(schemas.create_learning_recordSchema.safeParse({ ...input, body: { learningItemId: 9007199254740992 } }).success).toBe(false)
  })
})
