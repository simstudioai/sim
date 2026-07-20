/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationOnEnterprisePlan: vi.fn(),
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: vi.fn(),
}))

vi.mock('@/lib/workflows/input-format', () => ({
  extractInputFieldsFromBlocks: vi.fn(),
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadDeployedWorkflowState: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: vi.fn(),
}))

import {
  CustomBlockValidationError,
  publishCustomBlock,
  updateCustomBlock,
} from '@/lib/workflows/custom-blocks/operations'

const publishParams = {
  organizationId: 'org-1',
  workspaceId: 'ws-1',
  workflowId: 'wf-1',
  userId: 'user-1',
  name: 'Enrich Lead',
  description: '',
}

describe('reserved exposed-output names', () => {
  it('publishCustomBlock rejects an output named cost', async () => {
    await expect(
      publishCustomBlock({
        ...publishParams,
        exposedOutputs: [{ blockId: 'b1', path: 'price', name: 'cost' }],
      })
    ).rejects.toThrow(CustomBlockValidationError)
  })

  it('publishCustomBlock rejects reserved names case-insensitively', async () => {
    await expect(
      publishCustomBlock({
        ...publishParams,
        exposedOutputs: [{ blockId: 'b1', path: 'content', name: 'Success' }],
      })
    ).rejects.toThrow('"Success" is a reserved output name (success, error, cost)')
  })

  it('updateCustomBlock rejects a reserved output name', async () => {
    await expect(
      updateCustomBlock('cb-1', {
        exposedOutputs: [{ blockId: 'b1', path: 'content', name: 'error' }],
      })
    ).rejects.toThrow(CustomBlockValidationError)
  })
})
