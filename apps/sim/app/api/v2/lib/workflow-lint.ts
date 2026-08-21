import type { WorkflowLintBlockRef, WorkflowLintReport } from '@/lib/workflows/editing/lint'

/** Projects the shared block reference every lint finding carries onto the wire shape. */
function blockRef(ref: WorkflowLintBlockRef) {
  return {
    blockId: ref.blockId,
    blockName: ref.blockName ?? null,
    blockType: ref.blockType ?? null,
  }
}

/**
 * Projects a lint report onto the wire.
 *
 * Shared by the two graph writes so the report is byte-identical whichever one
 * produced it. The domain leaves an absent block name `undefined`; the contract
 * declares it `nullable`, because `undefined` is not a JSON value and a key that
 * simply vanishes is indistinguishable from one the server forgot to send. The
 * mapping is therefore load-bearing, not ceremony.
 */
export function presentWorkflowLint(lint: WorkflowLintReport) {
  return {
    sources: lint.sources.map(blockRef),
    sinks: lint.sinks.map(blockRef),
    orphanBlocks: lint.orphanBlocks.map(blockRef),
    emptyOutgoingPorts: lint.emptyOutgoingPorts.map((port) => ({
      ...blockRef(port),
      handle: port.handle,
      label: port.label,
    })),
    invalidBranchPorts: lint.invalidBranchPorts.map((port) => ({
      ...blockRef(port),
      sourceHandle: port.sourceHandle,
      reason: port.reason,
    })),
    invalidConnectionTargets: lint.invalidConnectionTargets.map((target) => ({
      sourceBlockId: target.sourceBlockId,
      sourceBlockName: target.sourceBlockName ?? null,
      sourceHandle: target.sourceHandle ?? null,
      targetBlockId: target.targetBlockId,
      reason: target.reason,
    })),
    fieldIssues: lint.fieldIssues.map((issue) => ({
      ...blockRef(issue),
      missingRequiredFields: issue.missingRequiredFields,
      inactiveModeValues: issue.inactiveModeValues.map((value) => ({
        canonicalId: value.canonicalId,
        activeMemberId: value.activeMemberId ?? null,
        inactiveMemberId: value.inactiveMemberId,
        kind: value.kind,
      })),
    })),
    unresolvedReferences: lint.unresolvedReferences.map((reference) => ({
      ...blockRef(reference),
      field: reference.field,
      value: reference.value,
      kind: reference.kind,
      reason: reference.reason,
    })),
    notes: lint.notes,
  }
}
