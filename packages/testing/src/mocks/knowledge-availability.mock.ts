import { vi } from 'vitest'

/** Mirrors `KnowledgeMemberAccessContext` from `@/lib/knowledge/access/availability`. */
interface KnowledgeMemberAccessContextLike {
  workspaceId?: string
  organizationId?: string
  userId?: string
}

/** Mirrors `KnowledgeAccessAvailability`. */
interface KnowledgeAccessAvailabilityLike {
  sourceMirrored: boolean
  memberScoped: boolean
}

/**
 * Stand-in for the `OrchestrationError` the real gates throw: same `name`, `code` and message.
 * It is not the real class, so `instanceof OrchestrationError` in code under test will not match;
 * tests that need that should override the `require*` fn with a real `OrchestrationError`.
 */
export class MockKnowledgeAvailabilityError extends Error {
  constructor(
    readonly code: 'forbidden' | 'validation',
    message: string
  ) {
    super(message)
    this.name = 'OrchestrationError'
  }
}

function ownerNoun(context: KnowledgeMemberAccessContextLike): string {
  return context.organizationId ? 'organization' : 'workspace'
}

/**
 * Controllable mock functions for `@/lib/knowledge/access/availability`.
 *
 * `mockResolveKnowledgeAccessAvailability` is the single knob: it defaults to fully available
 * (`{ sourceMirrored: true, memberScoped: true }`) and the other gates derive from it with the real
 * semantics — `isKnowledgeMemberAccessAvailable` returns `memberScoped`, and the `require*` gates
 * throw the real messages when their half is off. Override any gate directly when a test needs it
 * to disagree.
 *
 * @example
 * ```ts
 * import { knowledgeAvailabilityMockFns } from '@sim/testing/mocks/knowledge-availability.mock'
 *
 * knowledgeAvailabilityMockFns.mockResolveKnowledgeAccessAvailability.mockResolvedValue({
 *   sourceMirrored: true,
 *   memberScoped: false,
 * })
 * ```
 */
export const knowledgeAvailabilityMockFns = {
  mockResolveKnowledgeAccessAvailability: vi.fn(
    async (
      _context: KnowledgeMemberAccessContextLike
    ): Promise<KnowledgeAccessAvailabilityLike> => ({
      sourceMirrored: true,
      memberScoped: true,
    })
  ),
  mockForgetKnowledgeAccessAvailability: vi.fn((): void => {}),
  mockIsKnowledgeMemberAccessAvailable: vi.fn(
    async (context: KnowledgeMemberAccessContextLike): Promise<boolean> =>
      (await knowledgeAvailabilityMockFns.mockResolveKnowledgeAccessAvailability(context))
        .memberScoped
  ),
  mockRequireOrganizationSearchAvailable: vi.fn(async (organizationId: string): Promise<void> => {
    if (await knowledgeAvailabilityMockFns.mockIsKnowledgeMemberAccessAvailable({ organizationId }))
      return
    throw new MockKnowledgeAvailabilityError(
      'forbidden',
      'Search is not enabled for this organization'
    )
  }),
  mockRequireSourceMirroredAccessAvailable: vi.fn(
    async (context: KnowledgeMemberAccessContextLike): Promise<void> => {
      const availability =
        await knowledgeAvailabilityMockFns.mockResolveKnowledgeAccessAvailability(context)
      if (availability.sourceMirrored) return
      throw new MockKnowledgeAvailabilityError(
        'validation',
        `Administrator access is not available for this ${ownerNoun(context)}`
      )
    }
  ),
  mockRequireKnowledgeMemberAccessAvailable: vi.fn(
    async (context: KnowledgeMemberAccessContextLike): Promise<void> => {
      if (await knowledgeAvailabilityMockFns.mockIsKnowledgeMemberAccessAvailable(context)) return
      throw new MockKnowledgeAvailabilityError(
        'validation',
        `Per-member access is not available for this ${ownerNoun(context)}`
      )
    }
  ),
}

/**
 * Static mock module for `@/lib/knowledge/access/availability`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)
 * ```
 */
export const knowledgeAvailabilityMock = {
  resolveKnowledgeAccessAvailability:
    knowledgeAvailabilityMockFns.mockResolveKnowledgeAccessAvailability,
  forgetKnowledgeAccessAvailability:
    knowledgeAvailabilityMockFns.mockForgetKnowledgeAccessAvailability,
  isKnowledgeMemberAccessAvailable:
    knowledgeAvailabilityMockFns.mockIsKnowledgeMemberAccessAvailable,
  requireOrganizationSearchAvailable:
    knowledgeAvailabilityMockFns.mockRequireOrganizationSearchAvailable,
  requireSourceMirroredAccessAvailable:
    knowledgeAvailabilityMockFns.mockRequireSourceMirroredAccessAvailable,
  requireKnowledgeMemberAccessAvailable:
    knowledgeAvailabilityMockFns.mockRequireKnowledgeMemberAccessAvailable,
}
