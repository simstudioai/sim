/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  v2SyncApplyBodySchema,
  v2SyncPreviewBodySchema,
  v2SyncPreviewDataSchema,
  v2SyncTriggerMappingSchema,
} from '@/lib/api/contracts/v2/workspace-fork'

const trigger = {
  sourceWorkflowId: 'source-workflow',
  sourceBlockId: 'source-trigger',
  adoptPath: 'retiring-path',
}

describe('v2 sync trigger contracts', () => {
  it('requires stable source workflow and block identities on both preview and apply', () => {
    const preview = { otherWorkspaceId: 'other-workspace', triggerMappings: [trigger] }
    expect(v2SyncPreviewBodySchema.parse(preview).triggerMappings).toEqual([trigger])
    const apply = {
      ...preview,
      requestId: 'request',
      previewFingerprint: 'a'.repeat(64),
      confirm: true,
    }
    expect(v2SyncApplyBodySchema.parse(apply).triggerMappings).toEqual([trigger])
    const blockOnly = [{ sourceBlockId: trigger.sourceBlockId, adoptPath: trigger.adoptPath }]
    expect(
      v2SyncPreviewBodySchema.safeParse({ ...preview, triggerMappings: blockOnly }).success
    ).toBe(false)
    expect(v2SyncApplyBodySchema.safeParse({ ...apply, triggerMappings: blockOnly }).success).toBe(
      false
    )
  })

  it.each(['targetWorkflowId', 'targetBlockId', 'unknown'])(
    'rejects unknown nested choice field %s',
    (field) => {
      expect(v2SyncTriggerMappingSchema.safeParse({ ...trigger, [field]: 'value' }).success).toBe(
        false
      )
    }
  )

  it('accepts an explicit choice to allocate a new path', () => {
    expect(v2SyncTriggerMappingSchema.parse({ ...trigger, adoptPath: null }).adoptPath).toBeNull()
  })

  it('preserves public source trigger candidates and refuses generated target IDs in their shape', () => {
    const slot = {
      sourceWorkflowId: trigger.sourceWorkflowId,
      sourceBlockId: trigger.sourceBlockId,
      blockName: 'Slack trigger',
      workflowName: 'Workflow',
      ownPath: null,
      adoptablePaths: ['retiring-path'],
      defaultAdoptPath: 'retiring-path',
    }
    const preview = {
      previewFingerprint: 'a'.repeat(64),
      sourceWorkspaceId: 'source-workspace',
      targetWorkspaceId: 'target-workspace',
      ready: true,
      workflows: [],
      unresolvedBindings: [],
      configuration: [],
      excludedTargets: [],
      triggerSlots: [slot],
      triggerUrlChanges: [],
    }
    expect(v2SyncPreviewDataSchema.parse(preview).triggerSlots).toEqual([slot])
    expect(
      v2SyncPreviewDataSchema.safeParse({
        ...preview,
        triggerSlots: [{ ...slot, targetBlockId: 'generated-id' }],
      }).success
    ).toBe(false)
  })
})
