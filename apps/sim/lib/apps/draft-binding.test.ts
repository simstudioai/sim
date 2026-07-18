import { describe, expect, it } from 'vitest'
import {
  DRAFT_DEPLOYMENT_VERSION_SENTINEL,
  isDraftDeploymentVersionId,
} from '@/lib/apps/draft-binding'

describe('draft binding sentinel', () => {
  it('identifies the draft sentinel', () => {
    expect(isDraftDeploymentVersionId(DRAFT_DEPLOYMENT_VERSION_SENTINEL)).toBe(true)
    expect(isDraftDeploymentVersionId('dv-real')).toBe(false)
    expect(isDraftDeploymentVersionId(null)).toBe(false)
  })
})
