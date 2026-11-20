import { describe, expect, it } from 'vitest'
import type { WorkspaceBaseV1 } from './base'
import {
  type PromotionRecord,
  parsePromotionRecord,
  promotionRecord,
  promotionSubmission,
} from './promote'

const folderBase = (workflowId: string, fingerprint: string) =>
  JSON.stringify({ version: 1, workflowId, workspaceId: 'ws_prod', fingerprint, catalogHash: 'c' })

const DIR = {
  'workflows/ingest/workflow.ts': '// @sim-sdk 1\n',
  'workflows/ingest/.sim/base.json': folderBase('wf_dev', 'sf1:dev'),
}

const TARGET = {
  files: {
    'workflows/ingest/workflow.ts': '// @sim-sdk 1\n// prod hotfix\n',
    'workflows/ingest/.sim/base.json': folderBase('wf_prod', 'sf1:hotfix'),
  },
  base: {
    version: 1,
    workspaceId: 'ws_prod',
    resources: { 'workflow:ingest': { id: 'wf_prod' } },
  } satisfies WorkspaceBaseV1,
}

/** The record the first promotion of {@link DIR} leaves, with `plan` as the apply's. */
function firstRecord(plan: Array<{ kind: string; key: string; action: string; held?: boolean }>) {
  const submission = promotionSubmission({
    files: DIR,
    blobPaths: [],
    kinds: ['workflow'],
    target: TARGET,
    allowDelete: false,
  })
  return promotionRecord({
    workspaceId: 'ws_prod',
    previous: undefined,
    kinds: ['workflow'],
    files: DIR,
    submission,
    applied: { base: TARGET.base, files: {}, plan },
  })
}

describe('promotion records', () => {
  it('does not record a workflow the apply held back, so the next promotion sends it again', () => {
    const record = firstRecord([{ kind: 'workflow', key: 'ingest', action: 'update', held: true }])

    expect(record.workflows).toEqual({})
    const next = promotionSubmission({
      files: DIR,
      blobPaths: [],
      kinds: ['workflow'],
      target: TARGET,
      record,
      allowDelete: false,
    })
    expect(next.files['workflows/ingest/workflow.ts']).toBe(DIR['workflows/ingest/workflow.ts'])
  })

  it('sends an unchanged folder as its base alone, and an edited one with the recorded fingerprint', () => {
    const record = firstRecord([{ kind: 'workflow', key: 'ingest', action: 'noop' }])
    const promote = (files: Record<string, string>) =>
      promotionSubmission({
        files,
        blobPaths: [],
        kinds: ['workflow'],
        target: {
          ...TARGET,
          files: {
            ...TARGET.files,
            'workflows/ingest/.sim/base.json': folderBase('wf_prod', 'sf1:edited-in-prod'),
          },
        },
        record,
        allowDelete: false,
      })

    expect(Object.keys(promote(DIR).files)).toEqual(['workflows/ingest/.sim/base.json'])
    const edited = promote({ ...DIR, 'workflows/ingest/workflow.ts': '// @sim-sdk 1\n// v2\n' })
    expect(JSON.parse(edited.files['workflows/ingest/.sim/base.json']).fingerprint).toBe(
      'sf1:hotfix'
    )
  })

  it('ignores a record for another target, or one this build cannot read', () => {
    const record: PromotionRecord = {
      version: 1,
      workspaceId: 'ws_prod',
      resources: {},
      workflows: {},
    }

    expect(parsePromotionRecord(record, 'ws_prod')).toEqual(record)
    expect(parsePromotionRecord(record, 'ws_other')).toBeUndefined()
    expect(parsePromotionRecord({ ...record, workflows: { ingest: 1 } }, 'ws_prod')).toBeUndefined()
    expect(parsePromotionRecord({ ...record, version: 2 }, 'ws_prod')).toBeUndefined()
  })
})
