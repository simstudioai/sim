'use client'

import { useMemo } from 'react'
import {
  collectDeniedOperationIds,
  isOperationAllowed,
  MODEL_SUBBLOCK_ID,
  NO_DENIED_OPERATIONS,
  OPERATION_SUBBLOCK_ID,
  type OperationGateBlock,
  pickDefaultOperation,
  type SeedValueGate,
} from '@/lib/permission-groups/operation-access'
import { usePermissionConfig } from '@/hooks/use-permission-config'

export interface OperationAccess {
  /**
   * Whether the permission config is still loading. Every list this module
   * filters reads as unrestricted until it resolves, so a surface that
   * *persists* a pick from one must not accept input while this is true.
   */
  isPermissionLoading: boolean
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
   */
  resolveDefaultOperation: (
    block: OperationGateBlock | null | undefined,
    candidates: Iterable<string>,
    preferred?: string
  ) => string | undefined
  /**
   * A predicate for deciding whether an operation of `block` may be *persisted*
   * — or `undefined` while the permission config is still loading.
   *
   * The withholding is the point. The config resolves as "nothing denied" in
   * flight, so a value written during that window would outlive the correction
   * that arrives with it. Handing back `undefined` rather than an
   * always-`true` predicate means a caller cannot persist without first
   * deciding what to do when the answer is unknown.
   */
  resolveOperationGate: (
    block: OperationGateBlock | null | undefined
  ) => ((operationId: string) => boolean) | undefined
  /**
   * The veto `prepareBlockState` applies to a new block's declared defaults.
   *
   * Creation is one-shot, so unlike the pickers it cannot answer "unknown" by
   * waiting — a value written there is never revisited. This gate therefore
   * rejects both restricted fields until the config resolves, leaving them
   * empty for the pickers to fill, and owns that rule so no caller re-derives
   * it. Every other field passes through untouched.
   */
  resolveSeedGate: (block: OperationGateBlock | null | undefined) => SeedValueGate
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
  const { isToolAllowed, isModelUsable, isLoading } = usePermissionConfig()

  return useMemo(() => {
    const isReady = !isLoading
    return {
      isPermissionLoading: isLoading,
      getDeniedOperations: (block, operationIds) =>
        isReady
          ? collectDeniedOperationIds(block, operationIds, isToolAllowed)
          : NO_DENIED_OPERATIONS,
      resolveDefaultOperation: (block, candidates, preferred) =>
        isReady ? pickDefaultOperation(block, candidates, isToolAllowed, preferred) : undefined,
      resolveOperationGate: (block) =>
        isReady
          ? (operationId: string) => isOperationAllowed(block, operationId, isToolAllowed)
          : undefined,
      resolveSeedGate: (block) => (subBlockId, value) => {
        if (subBlockId !== OPERATION_SUBBLOCK_ID && subBlockId !== MODEL_SUBBLOCK_ID) return true
        if (!isReady) return false
        return subBlockId === OPERATION_SUBBLOCK_ID
          ? isOperationAllowed(block, value, isToolAllowed)
          : isModelUsable(value)
      },
    }
  }, [isToolAllowed, isModelUsable, isLoading])
}
