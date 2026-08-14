'use client'

import { useMemo } from 'react'
import {
  collectDeniedOperationIds,
  isOperationAllowed as isOperationAllowedFor,
  type OperationGateBlock,
  pickDefaultOperation,
} from '@/lib/permission-groups/operation-access'
import { usePermissionConfig } from '@/hooks/use-permission-config'

const EMPTY_DENIED: ReadonlySet<string> = new Set()

export interface OperationAccess {
  /**
   * Whether the caller's permission config has resolved. Filtering reads
   * optimistically before it does — a denied option stays visible for a beat —
   * but nothing may be *persisted* until it is true.
   */
  isReady: boolean
  /**
   * Whether the caller may run `operationId` of `block`. Answers `true` for
   * everything while the config loads, so a caller persisting on the answer
   * must check `isReady` first — the two withholding members below already do.
   */
  isOperationAllowed: (block: OperationGateBlock | null | undefined, operationId: string) => boolean
  /**
   * The operation ids of `block` the caller may not run. Empty while the
   * config loads, so pickers show everything rather than flashing a short list.
   */
  getDeniedOperations: (
    block: OperationGateBlock | null | undefined,
    operationIds: Iterable<string>
  ) => ReadonlySet<string>
  /**
   * The operation to seed an unset field with: `preferred` when allowed, else
   * the first allowed candidate.
   *
   * `undefined` while the config is loading, because it resolves as "nothing
   * denied" in flight and a default written then would outlive the correction —
   * a seeding caller only ever writes a defined value, so gating on
   * `!== undefined` is the whole guard.
   */
  resolveDefaultOperation: (
    block: OperationGateBlock | null | undefined,
    candidates: Iterable<string>,
    preferred?: string
  ) => string | undefined
}

/**
 * Permission-group access to a block's operations.
 *
 * The single place the "which operations may this user run, and which one
 * should an unset field land on" question is answered, so every surface that
 * offers operations — the block editor's dropdown, the agent block's tool list,
 * canvas search, block creation — agrees.
 */
export function useOperationAccess(): OperationAccess {
  const { isToolAllowed, isLoading } = usePermissionConfig()

  return useMemo(() => {
    const isReady = !isLoading
    return {
      isReady,
      isOperationAllowed: (block, operationId) =>
        isOperationAllowedFor(block, operationId, isToolAllowed),
      getDeniedOperations: (block, operationIds) =>
        isReady ? collectDeniedOperationIds(block, operationIds, isToolAllowed) : EMPTY_DENIED,
      resolveDefaultOperation: (block, candidates, preferred) =>
        isReady ? pickDefaultOperation(block, candidates, isToolAllowed, preferred) : undefined,
    }
  }, [isToolAllowed, isLoading])
}
