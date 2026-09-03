import { z } from 'zod'
import { nonEmptyIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { workspaceSchema } from '@/lib/api/contracts/workspaces'

const workspaceIdParamsSchema = z.object({ id: nonEmptyIdSchema })

export const forkRemapKindSchema = z.enum([
  'credential',
  'env-var',
  'knowledge-base',
  'knowledge-document',
  'table',
  'file',
  'file-folder',
  'mcp-server',
  'custom-tool',
  /**
   * A published custom block, referenced by the placed block's `type` rather than by any
   * sub-block value — the only remap kind that rewrites the block itself.
   */
  'custom-block',
  'skill',
])

export const forkResourceTypeSchema = z.enum([
  'workflow',
  'oauth_credential',
  'service_account_credential',
  'env_var',
  'table',
  'knowledge_base',
  'knowledge_document',
  'file',
  'file_folder',
  'mcp_server',
  /**
   * Workflow-publishing MCP server identity (parent shell <-> fork copy), seeded at fork so a
   * sync can mirror `workflow_mcp_tool` attachments onto the mapped counterpart. System-managed;
   * never user-mapped (nothing in a workflow references these servers).
   */
  'workflow_mcp_server',
  /**
   * Published custom block (deploy-as-block). Mapped, never copied: a custom block is
   * org-scoped and binds a workflow in the PUBLISHER's workspace, so an environment fork
   * repoints its placed blocks at the environment's own block rather than duplicating one.
   */
  'custom_block',
  'custom_tool',
  'skill',
])

/**
 * Resource types a user may map via the mapping editor. Excludes `workflow` (identity is
 * system-managed - seeded at fork, maintained by promote, dissolved by rollback - and must never
 * be written through the editor, or a crafted entry could repoint a promote at the wrong target
 * workflow), `workflow_mcp_server` (identity is likewise system-managed - seeded when a fork
 * copies the server shells - and nothing in a workflow references one, so there is never a
 * mapping entry to edit), AND `knowledge_document` (a document is never a standalone mapping: it
 * follows its parent knowledge base, re-picked in that KB's reconfigure flow and auto-remapped
 * when the KB is copied - the mapping view never emits one and `listForkResourceCandidates`
 * returns none).
 */
export const forkMappableResourceTypeSchema = forkResourceTypeSchema.exclude([
  'workflow',
  'workflow_mcp_server',
  'knowledge_document',
])
export type ForkMappableResourceType = z.infer<typeof forkMappableResourceTypeSchema>

export const forkDirectionSchema = z.enum(['push', 'pull'])

/**
 * The remappable, copyable resource kinds a sync can copy into the target when they are
 * unmapped (the fork-style copy at promote time), whether referenced by the synced workflows or
 * not. Excludes credentials and env vars (never copied); documents are auto-copied with their
 * parent knowledge base, not selected individually. Workspace `file` references are keyed by
 * storage key (not `workspace_files.id`) and copied like fork does.
 */
export const forkCopyableKindSchema = z.enum([
  'knowledge-base',
  'table',
  'custom-tool',
  'skill',
  'file',
  /**
   * External MCP servers copy as CONFIG rows (transport/url/headers verbatim; OAuth tokens
   * never copied - oauth-auth servers land disconnected until re-authorized in the target).
   */
  'mcp-server',
])
export type ForkCopyableKind = z.infer<typeof forkCopyableKindSchema>

export const forkLineageNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  organizationId: z.string().nullable(),
  /**
   * Whether the viewer has any access (read or higher, explicit or org-derived) to this
   * lineage workspace. Drives the Forks page's row-action gating - lineage rows are visible
   * to any admin of the CURRENT workspace, who may hold no access to the other side.
   */
  viewerAccessible: z.boolean(),
})

/** A live fork of this workspace, listed read-only on the Forks settings page. */
export const forkLineageChildSchema = forkLineageNodeSchema.extend({
  /** When the fork was created (ISO timestamp). */
  createdAt: z.string(),
})

export const getForkLineageContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/fork/lineage',
  params: workspaceIdParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      workspaceId: z.string(),
      parent: forkLineageNodeSchema.nullable(),
      /** Live forks created from this workspace, newest first. */
      children: z.array(forkLineageChildSchema),
      /** The most recent undoable promote into this workspace, for the rollback UI. */
      undoableRun: z
        .object({
          otherWorkspaceId: z.string(),
          otherName: z.string(),
          direction: forkDirectionSchema,
        })
        .nullable(),
    }),
  },
})
export type ForkLineageNodeApi = z.output<typeof forkLineageNodeSchema>
export type ForkLineageChildApi = z.output<typeof forkLineageChildSchema>
export type GetForkLineageResponse = z.output<typeof getForkLineageContract.response.schema>

export const MAX_FORK_RESOURCE_IDS_PER_TYPE = 2_000

const forkResourceIdList = z.array(nonEmptyIdSchema).max(MAX_FORK_RESOURCE_IDS_PER_TYPE).optional()

export const forkResourceSelectionSchema = z.object({
  files: forkResourceIdList,
  tables: forkResourceIdList,
  knowledgeBases: forkResourceIdList,
  customTools: forkResourceIdList,
  skills: forkResourceIdList,
  /**
   * External MCP servers, copied as config rows (transport/url/headers) so MCP tool selections
   * in the forked workflows keep working. OAuth tokens are never copied - an oauth-auth server
   * lands disconnected in the child until re-authorized; tools re-discover on first use.
   */
  mcpServers: forkResourceIdList,
  /** Workflow-publishing MCP servers, copied as config-only shells with no workflows attached. */
  workflowMcpServers: forkResourceIdList,
})

export const forkWorkspaceBodySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name is too long').optional(),
  copy: forkResourceSelectionSchema.optional(),
})
export const forkWorkspaceContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/fork',
  params: workspaceIdParamsSchema,
  body: forkWorkspaceBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      // Full workspace row so the client can merge it into the workspace-list cache
      // (parity with create), not just the lineage node.
      workspace: workspaceSchema,
      workflowsCopied: z.number().int(),
    }),
  },
})
export type ForkWorkspaceBody = z.input<typeof forkWorkspaceBodySchema>
export type ForkWorkspaceResponse = z.output<typeof forkWorkspaceContract.response.schema>

export const forkCopyableResourceSchema = z.object({ id: z.string(), label: z.string() })
export type ForkCopyableResource = z.output<typeof forkCopyableResourceSchema>

/**
 * A copyable workspace file plus its folder grouping. `folderId`/`folderName` are null when
 * the file sits at the workspace root (or its folder was deleted). Files are the only copyable
 * kind that nests in the picker (folder ▸ file); every other kind stays flat at the top level.
 */
export const forkCopyableFileSchema = forkCopyableResourceSchema.extend({
  folderId: z.string().nullable(),
  folderName: z.string().nullable(),
})
export type ForkCopyableFile = z.output<typeof forkCopyableFileSchema>

export const getForkResourcesContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/fork/resources',
  params: workspaceIdParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      files: z.array(forkCopyableFileSchema),
      tables: z.array(forkCopyableResourceSchema),
      knowledgeBases: z.array(forkCopyableResourceSchema),
      customTools: z.array(forkCopyableResourceSchema),
      skills: z.array(forkCopyableResourceSchema),
      /** External MCP servers (config rows; OAuth tokens never copied). */
      mcpServers: z.array(forkCopyableResourceSchema),
      workflowMcpServers: z.array(forkCopyableResourceSchema),
      deployedWorkflowCount: z.number().int(),
    }),
  },
})
export type GetForkResourcesResponse = z.output<typeof getForkResourcesContract.response.schema>

export const forkMappingCandidateSchema = z.object({
  id: z.string(),
  label: z.string(),
  providerId: z.string().optional(),
})

export const forkMappingEntrySchema = z.object({
  kind: forkRemapKindSchema,
  resourceType: forkMappableResourceTypeSchema,
  sourceId: z.string(),
  sourceLabel: z.string(),
  targetId: z.string().nullable(),
  /** True when `targetId` is an unconfirmed auto-suggestion (no persisted mapping yet). */
  suggested: z.boolean(),
  required: z.boolean(),
  /**
   * True when the referenced resource no longer exists in the SOURCE workspace, so `sourceLabel`
   * falls back to the raw id. Checked by exact id (never the capped candidate list), so this is
   * unambiguous: a live resource always resolves its name, however many the workspace has. Such a
   * reference cannot be offered for copy - there is nothing to copy - so the resolutions are
   * mapping it to a live target, fixing the block in the source, or dropping it.
   */
  sourceDeleted: z.boolean(),
  candidates: z.array(forkMappingCandidateSchema),
  /**
   * True when the target workspace has more candidates of this kind than the picker
   * loads, so the list shown is partial. The UI surfaces a "refine to find more"
   * notice; the chosen target is validated by exact id on save (never capped).
   */
  candidatesTruncated: z.boolean(),
})
export type ForkMappingEntry = z.output<typeof forkMappingEntrySchema>

export const getForkMappingQuerySchema = z.object({
  otherWorkspaceId: workspaceIdSchema,
  direction: forkDirectionSchema.default('push'),
})
export const getForkMappingContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/fork/mapping',
  params: workspaceIdParamsSchema,
  query: getForkMappingQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      childWorkspaceId: z.string(),
      parentWorkspaceId: z.string(),
      sourceWorkspaceId: z.string(),
      targetWorkspaceId: z.string(),
      entries: z.array(forkMappingEntrySchema),
    }),
  },
})
export type GetForkMappingResponse = z.output<typeof getForkMappingContract.response.schema>

/**
 * One dependent field's value in the stored mapping. The sync modal and the Forks
 * settings page's mapping editor send the full set for every dependent whose parent is
 * mapped; the server persists them to `workspace_fork_dependent_value` (promote also
 * applies them verbatim to the target blocks), so the user's selection survives every
 * future sync without re-picking. `blockId` is the deterministic fork block id, so the
 * value lands on the right block.
 */
export const forkDependentValueEntrySchema = z.object({
  workflowId: nonEmptyIdSchema,
  blockId: nonEmptyIdSchema,
  subBlockKey: z.string().min(1, 'subBlockKey is required'),
  value: z.string(),
})
export type ForkDependentValueEntry = z.input<typeof forkDependentValueEntrySchema>

export const updateForkMappingBodySchema = z.object({
  otherWorkspaceId: workspaceIdSchema,
  direction: forkDirectionSchema,
  entries: z
    .array(
      z.object({
        resourceType: forkMappableResourceTypeSchema,
        sourceId: z.string().min(1),
        targetId: z.string().min(1).nullable(),
      })
    )
    .max(5000),
  /**
   * The full stored mapping of dependent-field values for the workflows it names; persisted
   * to `workspace_fork_dependent_value` alongside the mapping entries (each named workflow's
   * stored set is replaced by exactly what was sent - cleared fields drop out). Omitting the
   * field leaves the stored mapping untouched. Unlike promote this only stores the values;
   * they are applied to the target blocks on the next sync.
   */
  dependentValues: z.array(forkDependentValueEntrySchema).max(2000).optional(),
})
export const updateForkMappingContract = defineRouteContract({
  method: 'PUT',
  path: '/api/workspaces/[id]/fork/mapping',
  params: workspaceIdParamsSchema,
  body: updateForkMappingBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true), updated: z.number().int() }),
  },
})
export type UpdateForkMappingBody = z.input<typeof updateForkMappingBodySchema>

export const forkUnmappedReferenceSchema = z.object({
  kind: forkRemapKindSchema,
  sourceId: z.string(),
  required: z.boolean(),
  blockName: z.string().optional(),
})

export const forkWorkflowChangeSchema = z.object({
  action: z.enum(['update', 'create', 'archive']),
  /** Workflow name in the workspace the modal is open in. */
  currentName: z.string(),
  /** Workflow name in the sync-partner workspace (differs from `currentName` after a rename). */
  otherName: z.string(),
})

/**
 * A configured selector field (Gmail label, Slack channel, KB document, ...) that
 * `dependsOn` a remappable parent resource - a credential or a knowledge base - so a
 * sync clears it whenever that parent's target changes. The modal renders a controlled
 * selector against the newly-chosen parent (using `selectorKey` + `context` + the new
 * parent value under `parentContextKey`) so the user re-picks the value in place,
 * pre-sync, instead of having it cleared and reconfigured after. `targetBlockId` is the
 * deterministic fork block id, matching the engine, so the re-pick lands on the right
 * block. Only fields the source actually had set are emitted (the active operation's),
 * so blocks aren't padded with every operation variant.
 */
export const forkDependentReconfigSchema = z.object({
  /**
   * The remappable parent whose target swap makes this field reconfigurable. For
   * `custom-block` the "parent" IS the block itself: repointing it at another environment's
   * block makes EVERY one of its inputs reconfigurable, not the `dependsOn` subset a
   * credential/KB/table swap invalidates.
   */
  parentKind: z.enum(['credential', 'knowledge-base', 'table', 'custom-block']),
  /** Source id of that parent (matches a mapping entry's `sourceId`). */
  parentSourceId: z.string(),
  /**
   * SelectorContext key the new parent value is supplied under (`oauthCredential` |
   * `knowledgeBaseId` | `tableId`). Absent for `custom-block`: its inputs are plain typed
   * fields, not selectors, so there is no parent value to feed them.
   */
  parentContextKey: z.string().optional(),
  targetWorkflowId: z.string(),
  targetBlockId: z.string(),
  blockName: z.string(),
  subBlockKey: z.string(),
  /** Absent for `custom-block` fields, which are typed inputs rather than selectors. */
  selectorKey: z.string().optional(),
  /**
   * A `custom-block` input's declared field type (`string` | `number` | `boolean` | `object` |
   * `array` | ...), so the modal renders the matching control instead of a selector.
   */
  fieldType: z.string().optional(),
  /** Plain field title (e.g. `Label`), never a `Tool: Field` composite. */
  title: z.string(),
  /**
   * Display name of the nested `tool-input` tool this field belongs to (e.g. `Gmail` /
   * `Gmail 1`). Absent for top-level block subblocks.
   */
  toolName: z.string().optional(),
  /**
   * Stable scope for one nested tool instance (e.g. `tools[0]`). Dependency context and
   * descendant invalidation never cross this boundary, even when two tools expose the same
   * canonical parameter ids. Absent for top-level block subblocks, which share the block scope.
   */
  dependencyScope: z.string().optional(),
  /**
   * The field's stored value (from the persisted mapping), so the always-on reconfigure listing
   * pre-fills the selector with what the user last set. Empty string when unset; for an edge
   * that predates the store the TARGET's currently-configured value is the fallback (never the
   * source's, which would overwrite the target's own selection on the first sync). After a
   * parent target CHANGE the modal ignores this and starts blank, since the old value no longer
   * resolves against the new parent.
   */
  currentValue: z.string(),
  /**
   * The field's raw value in the SOURCE workflow state (what the source references today),
   * untouched by the stored/target-draft overlay that `currentValue` carries. Seeds the selector
   * when the parent is resolved by COPY: the copy brings the source parent's children along, so
   * the source reference is exactly what the copied parent will contain.
   */
  sourceValue: z.string(),
  /** Whether the field is required - a required empty field blocks Sync. */
  required: z.boolean(),
  /**
   * SelectorContext key this field's own value supplies to its in-block descendants
   * (e.g. a spreadsheet feeds `spreadsheetId` to the sheet selector). Lets the modal
   * chain re-picks: a re-picked parent updates its children's selector context.
   */
  providesContextKey: z.string().optional(),
  /**
   * SelectorContext keys this field needs from in-block siblings (excluding the parent
   * the modal already supplies). The modal keeps the field disabled until each sibling
   * that provides one of these keys has been re-picked, so a child never queries a stale
   * upstream value.
   */
  consumesContextKeys: z.array(z.string()),
  /** Source-derived selector context (sans the parent key the modal supplies). */
  context: z.record(z.string(), z.string()),
})
export type ForkDependentReconfig = z.output<typeof forkDependentReconfigSchema>

/**
 * Every workflow a mapped resource (any kind) is used in, for the always-on reconfigure
 * listing under each mapping entry. Joined to the entry by `(parentKind, parentSourceId)`;
 * the modal cross-references {@link forkDependentReconfigSchema} per workflow to decide which
 * rows are expandable (have configurable dependents) vs. greyed (used here, nothing to tune).
 */
export const forkResourceUsageSchema = z.object({
  parentKind: forkRemapKindSchema,
  parentSourceId: z.string(),
  workflows: z.array(
    z.object({
      /** Deterministic fork (target) workflow id - matches a dependent's `targetWorkflowId`. */
      workflowId: z.string(),
      workflowName: z.string(),
    })
  ),
})
export type ForkResourceUsage = z.output<typeof forkResourceUsageSchema>

/** Fields shared by every cleared-ref variant: the labels to phrase the "will be cleared" line. */
const forkClearedRefBaseSchema = z.object({
  targetWorkflowId: z.string(),
  workflowName: z.string(),
  blockId: z.string(),
  blockLabel: z.string(),
  fieldLabel: z.string(),
  sourceId: z.string(),
  sourceLabel: z.string(),
})

/**
 * A reference in a synced source workflow that this sync would blank in the target, with the
 * labels to phrase it as "{blockLabel} will lose {fieldLabel} in workflow {workflowName}". A
 * discriminated union on `cause` so clients narrow exhaustively (only `dependent` carries the parent
 * fields):
 *  - `reference`: an unmapped remappable resource (`kind`). BLOCKS the sync until the user maps it
 *    OR selects it for copy (matched to a mapping entry by `${kind}:${sourceId}`); the entry drops
 *    off the blocker list once resolved.
 *  - `workflow`: a `workflow-selector`/`workflow_input` ref to a workflow not carried into the
 *    target. BLOCKS the sync; resolved outside the modal (deploy the referenced workflow in the
 *    source, or remove/fix the reference).
 *  - `dependent`: a create-target dependent selector a remapped parent clears. NOT a blocker (the
 *    reconfigure flow owns dependents). Carries the parent (`parentKind`/`parentSourceId`); when the
 *    child follows its parent (a document under a knowledge base) the client drops it once that
 *    parent is mapped/copied, else it stays (credential label / table column).
 */
export const forkClearedRefSchema = z.discriminatedUnion('cause', [
  forkClearedRefBaseSchema.extend({
    cause: z.literal('reference'),
    /** The unmapped remappable resource (never `workflow`). */
    kind: forkRemapKindSchema,
    /**
     * True when the referenced resource no longer exists (deleted/archived) in the SOURCE
     * workspace, so it cannot be offered for copy - the resolution is mapping the dead source id
     * to a live target resource, or fixing the source workflow. Collected as `false` and
     * annotated post-collection by the source-liveness check (`annotateForkClearedRefSourceLiveness`).
     */
    sourceDeleted: z.boolean(),
  }),
  forkClearedRefBaseSchema.extend({
    cause: z.literal('workflow'),
    kind: z.literal('workflow'),
  }),
  forkClearedRefBaseSchema.extend({
    cause: z.literal('dependent'),
    /** Mirrors `parentKind` - the parent resource the cleared dependent hangs off. */
    kind: forkRemapKindSchema,
    /** The dependsOn parent; the entry drops off once this parent is mapped/copied (KB-document case). */
    parentKind: forkRemapKindSchema,
    parentSourceId: z.string(),
  }),
])
export type ForkClearedRef = z.output<typeof forkClearedRefSchema>

/**
 * Why a would-clear reference blocks the sync, so clients can phrase the resolution:
 *  - `unmapped-copyable`: a live copyable-kind resource (table / KB / file / custom tool /
 *    skill / external MCP server) with no target mapping - resolve by mapping it or selecting
 *    it for copy.
 *  - `source-deleted`: the referenced resource was deleted in the source - resolve by mapping the
 *    dead id to an existing live target resource, or by fixing/archiving the source workflow.
 *  - `workflow-missing`: a cross-workflow reference to a workflow not carried into the target -
 *    resolve by deploying the referenced workflow in the source, or removing the reference.
 *  - `unmapped-custom-block`: a placed custom block with no target mapping. Unlike every other
 *    unmapped reference this one does NOT clear - a block's type cannot be emptied without
 *    deleting the node - so the target would silently keep invoking the SOURCE environment's
 *    block. Blocking is what makes that visible; resolve by mapping it to the target
 *    environment's own published block.
 */
export const forkSyncBlockerReasonSchema = z.enum([
  'unmapped-copyable',
  'source-deleted',
  'workflow-missing',
  'unmapped-custom-block',
])
export type ForkSyncBlockerReason = z.output<typeof forkSyncBlockerReasonSchema>

/**
 * One reference that blocked a promote at the server gate (the authoritative in-tx re-check of
 * the would-clear set). Mirrors the cleared-ref labels so the client can phrase each blocker;
 * `kind` is `workflow` for cross-workflow references. `sourceLabel` may fall back to `sourceId`
 * (the gate skips display-label loading); the modal's refreshed diff carries the labeled list.
 */
export const forkSyncBlockerSchema = z.object({
  workflowName: z.string(),
  blockLabel: z.string(),
  fieldLabel: z.string(),
  kind: z.union([forkRemapKindSchema, z.literal('workflow')]),
  sourceId: z.string(),
  sourceLabel: z.string(),
  reason: forkSyncBlockerReasonSchema,
})
export type ForkSyncBlocker = z.output<typeof forkSyncBlockerSchema>

export const getForkDiffQuerySchema = z.object({
  otherWorkspaceId: workspaceIdSchema,
  direction: forkDirectionSchema,
})
/**
 * A public trigger URL a sync would stop serving in the target. Surfaced before the overwrite is
 * confirmed, because the external system calling it - a Slack Request URL, a provider webhook
 * subscription - has to be repointed by hand afterwards.
 */
export const forkTriggerUrlChangeSchema = z.object({
  workflowName: z.string(),
  /** The path that stops being served. A URL an arriving trigger adopts is not reported here. */
  path: z.string(),
})
export type ForkTriggerUrlChange = z.output<typeof forkTriggerUrlChangeSchema>

/**
 * One trigger block in this sync that has a public webhook URL, or whose URL is up for decision.
 *
 * Both cases get an entry, not just the decisions, so the Trigger URLs section reads as a
 * standing statement of each URL rather than an alert that appears only when something is wrong.
 * A trigger already serving one reports it as `ownPath` and keeps it - `adoptablePaths` is empty
 * and the row is informational. A trigger arriving without one lists the URLs retiring in the
 * SAME target workflow; picking one hands that live URL to the new block, so the external caller
 * - a Slack Request URL, a provider webhook subscription - keeps working untouched.
 *
 * Triggers with neither are absent, because whether a block serves a URL at all is only knowable
 * from its webhook row: a schedule, chat, manual or poller trigger never gets one, and no
 * declarative flag on the trigger definition separates them cleanly.
 */
export const forkTriggerMappingSchema = z.object({
  /** The SOURCE block id - stable across the sync, and what a chosen mapping is keyed by. */
  sourceBlockId: z.string(),
  blockName: z.string(),
  workflowName: z.string(),
  /**
   * The URL path this trigger already serves in the target, which the sync preserves verbatim.
   * Null when the target block has no webhook yet, i.e. the sync decides its URL.
   */
  ownPath: z.string().nullable(),
  /**
   * Retiring URLs in the same target workflow this block may take over instead of minting a new
   * one. Always empty when `ownPath` is set: a trigger that already serves a URL keeps it, and
   * offering it a second one would only be a way to abandon the first.
   */
  adoptablePaths: z.array(z.string()),
  /** The pre-selected pairing: unambiguous only when one URL retires and one trigger arrives. */
  defaultAdoptPath: z.string().nullable(),
})
export type ForkTriggerMapping = z.output<typeof forkTriggerMappingSchema>

export const getForkDiffContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/fork/diff',
  params: workspaceIdParamsSchema,
  query: getForkDiffQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      sourceWorkspaceId: z.string(),
      targetWorkspaceId: z.string(),
      willUpdate: z.number().int(),
      willCreate: z.number().int(),
      willArchive: z.number().int(),
      /** Per-workflow change list for the sync preview. */
      workflows: z.array(forkWorkflowChangeSchema),
      /**
       * Names of deployed SOURCE workflows marked "Exclude from sync" - never sent.
       * Defaulted so a new client tolerates an old server's response during rollout.
       */
      excludedSourceWorkflows: z.array(z.string()).default([]),
      /**
       * Names of mapped TARGET workflows marked "Exclude from sync" - the sync
       * neither replaces nor archives them. Defaulted for rollout tolerance.
       */
      excludedTargetWorkflows: z.array(z.string()).default([]),
      unmappedRequired: z.array(forkUnmappedReferenceSchema),
      unmappedOptional: z.array(forkUnmappedReferenceSchema),
      /** Source MCP server ids that use OAuth and need re-authorization in the target. */
      mcpReauthServerIds: z.array(z.string()),
      /** Review-only descriptions of inline secrets that cannot be id-mapped. */
      inlineSecretSources: z.array(z.string()),
      /** Configured selector fields per parent (credential/KB), for the pre-sync reconfigure. */
      dependentReconfigs: z.array(forkDependentReconfigSchema),
      /** Every workflow each mapped resource is used in, for the always-on reconfigure listing. */
      resourceUsages: z.array(forkResourceUsageSchema),
      /**
       * Copyable resources with no target mapping that the sync can copy into the target
       * (fork-style). `referenced: true` entries are referenced by the synced workflows and
       * default-selected in the modal (deselecting one clears its references); `referenced: false`
       * entries exist in the source but are used by no synced workflow and default-unselected
       * (skipping one breaks nothing). Documents under a selected knowledge base are copied
       * automatically. `parentId`/`parentLabel` carry the folder grouping for file entries
       * (id + name); they are null for non-file kinds and for files at the workspace root.
       */
      copyableUnmapped: z.array(
        z.object({
          kind: forkCopyableKindSchema,
          sourceId: z.string(),
          label: z.string(),
          parentId: z.string().nullable(),
          parentLabel: z.string().nullable(),
          /** Whether any synced workflow references this resource (drives the copy default). */
          referenced: z.boolean(),
        })
      ),
      /**
       * References this sync will blank in the target, with labels for a pre-sync "what will be
       * cleared" list. The client filters this against the current mapping/copy selection so a
       * `reference` item disappears once mapped or selected for copy; `workflow`/`dependent` items
       * always clear (informational).
       */
      clearedRefs: z.array(forkClearedRefSchema),
      /**
       * Every public trigger URL this sync retires in the target, BEFORE any adoption is applied.
       *
       * Deliberately pre-adoption: which of these actually stop being served depends on the
       * caller's live picks in `triggerMappings`, which only exist client-side until the promote
       * call. Returning the post-default set instead would freeze the preview at the server's
       * guess, so choosing "Generate new URL" would kill a URL the confirm never warned about.
       * Defaulted so a new client tolerates an old server's response during rollout.
       */
      retiringTriggerUrls: z.array(forkTriggerUrlChangeSchema).default([]),
      /** Arriving trigger blocks whose URL this sync decides, with their adoptable alternatives. */
      triggerMappings: z.array(forkTriggerMappingSchema).default([]),
    }),
  },
})
export type GetForkDiffResponse = z.output<typeof getForkDiffContract.response.schema>
export type ForkWorkflowChange = z.output<typeof forkWorkflowChangeSchema>
export type ForkCopyableUnmapped = GetForkDiffResponse['copyableUnmapped'][number]

/**
 * A workflow whose required dependent fields a sync cleared because their parent
 * (e.g. a credential) was changed - the target must re-pick them. The workflow's
 * draft holds the synced state but it was NOT redeployed (the prior version keeps
 * running), so nothing runs broken until the user reconfigures.
 */
export const forkNeedsConfigurationSchema = z.object({
  workflowName: z.string(),
  /** Names of the blocks in the workflow that need a re-check (deduplicated). */
  blocks: z.array(z.string()).min(1),
})
export type ForkNeedsConfiguration = z.output<typeof forkNeedsConfigurationSchema>

/**
 * Source resource ids (by kind) the user chose to copy into the target before the sync gate -
 * unmapped resources, whether referenced by the synced workflows or not. Each kind's documents
 * under a copied knowledge base are discovered + copied automatically (the user selects only
 * the parent resources).
 */
export const promoteCopyResourcesSchema = z.object({
  knowledgeBases: forkResourceIdList,
  tables: forkResourceIdList,
  customTools: forkResourceIdList,
  skills: forkResourceIdList,
  /** Workspace files to copy, identified by storage key (not `workspace_files.id`). */
  files: forkResourceIdList,
  /** External MCP servers to copy as config rows (OAuth tokens never copied - re-auth). */
  mcpServers: forkResourceIdList,
})
export type PromoteCopyResources = z.input<typeof promoteCopyResourcesSchema>

export const promoteForkBodySchema = z.object({
  otherWorkspaceId: workspaceIdSchema,
  direction: forkDirectionSchema,
  /**
   * The full stored mapping of dependent-field values; persisted to
   * `workspace_fork_dependent_value` and applied to the target blocks verbatim. Omitting the
   * field leaves the stored mapping untouched (the store stays the source of truth); sending
   * an explicit `[]` clears it for the written replace targets.
   */
  dependentValues: z.array(forkDependentValueEntrySchema).max(2000).optional(),
  /** Referenced-but-unmapped resources to copy into the target before the sync gate (U17). */
  copyResources: promoteCopyResourcesSchema.optional(),
  /**
   * References the user explicitly acknowledged dropping, so the sync may clear them in the
   * target instead of blocking. Honoured ONLY for a reference whose resource no longer exists in
   * the source workspace - the server re-derives that liveness inside the promote transaction and
   * ignores an acknowledgment for anything still live, so a working reference can never be
   * dropped and the zero-cleared-refs invariant relaxes only where the source is already broken.
   */
  dropReferences: z
    .array(z.object({ kind: forkRemapKindSchema, sourceId: z.string().min(1) }))
    .max(2000)
    .optional(),
  /**
   * Which retiring public URL each arriving trigger takes over, overriding the unambiguous
   * default. `adoptPath: null` means "mint a new URL for this trigger". The server re-derives the
   * adoptable set inside the promote transaction and ignores a path that slot did not offer, so a
   * URL can never be moved between workflows (which the per-workflow path claim forbids anyway).
   */
  triggerMappings: z
    .array(z.object({ sourceBlockId: z.string().min(1), adoptPath: z.string().min(1).nullable() }))
    .max(500)
    .optional(),
})
export const promoteForkContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/fork/promote',
  params: workspaceIdParamsSchema,
  body: promoteForkBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      promoteRunId: z.string(),
      updated: z.number().int(),
      created: z.number().int(),
      archived: z.number().int(),
      redeployed: z.number().int(),
      deployFailed: z.number().int(),
      unmappedRequired: z.array(forkUnmappedReferenceSchema),
      /**
       * References the sync would have cleared, so it was blocked without writing (the
       * authoritative in-tx gate; non-empty only when `promoteRunId` is empty). Normally the
       * client blocks first - this fires only when the state changed between preview and Sync.
       */
      blockers: z.array(forkSyncBlockerSchema),
      /** Workflows whose required dependent fields the target must re-pick post-sync. */
      needsConfiguration: z.array(forkNeedsConfigurationSchema),
      /** Workflows whose optional dependent fields a swap cleared (surfaced, not gated). */
      clearedOptional: z.array(forkNeedsConfigurationSchema),
      /**
       * Acknowledged source-deleted references this sync cleared in the target instead of
       * blocking on. Only entries whose source was verified gone in-transaction appear here, so
       * an acknowledgment the server refused is visibly absent.
       */
      droppedReferences: z
        .array(z.object({ kind: forkRemapKindSchema, sourceId: z.string() }))
        .default([]),
      /**
       * Public trigger URLs this sync stopped serving, because no arriving trigger adopted them.
       * Reported after the fact so the post-sync toast can name what needs re-registering.
       * Defaulted alongside the rest, so an old server's response still parses.
       */
      triggerUrlChanges: z.array(forkTriggerUrlChangeSchema).default([]),
    }),
  },
})
export type PromoteForkBody = z.input<typeof promoteForkBodySchema>
export type PromoteForkResponse = z.output<typeof promoteForkContract.response.schema>

/** Structured detail for a background job, surfaced in the Activity tab's expand row. */
export const backgroundWorkMetadataSchema = z
  .object({
    /** Display name of the user who performed the action (denormalized at write time). */
    actorName: z.string().optional(),
    // Fork content copy
    childWorkspaceId: z.string().optional(),
    childWorkspaceName: z.string().optional(),
    workflowsCopied: z.number().int().optional(),
    tables: z.number().int().optional(),
    knowledgeBases: z.number().int().optional(),
    files: z.number().int().optional(),
    copied: z.number().int().optional(),
    failed: z.number().int().optional(),
    /** Count of failed resources whose dangling references were cleared post-fork (U8). */
    clearedReferences: z.number().int().optional(),
    /** True when a reference-clear phase threw, so cleanup is incomplete (placeholders not dropped). */
    clearingFailed: z.boolean().optional(),
    /** Names of the resources a fork copied, by kind, for the report breakdown. */
    workflowNames: z.array(z.string()).optional(),
    tableNames: z.array(z.string()).optional(),
    knowledgeBaseNames: z.array(z.string()).optional(),
    fileNames: z.array(z.string()).optional(),
    customToolNames: z.array(z.string()).optional(),
    skillNames: z.array(z.string()).optional(),
    mcpServerNames: z.array(z.string()).optional(),
    workflowMcpServerNames: z.array(z.string()).optional(),
    // Sync / rollback
    /**
     * The other side of the fork edge (by id) for sync/rollback/sync-copy rows. Written so
     * the activity query can surface a row to BOTH edge workspaces, and so the client can
     * tell which side a row was recorded on.
     */
    otherWorkspaceId: z.string().optional(),
    otherWorkspaceName: z.string().optional(),
    direction: z.enum(['push', 'pull']).optional(),
    updated: z.number().int().optional(),
    created: z.number().int().optional(),
    archived: z.number().int().optional(),
    redeployed: z.number().int().optional(),
    deployFailed: z.number().int().optional(),
    restored: z.number().int().optional(),
    unarchived: z.number().int().optional(),
    removed: z.number().int().optional(),
    skipped: z.number().int().optional(),
    /** Names of the workflows a sync changed, by action, for the report breakdown. */
    updatedNames: z.array(z.string()).optional(),
    createdNames: z.array(z.string()).optional(),
    archivedNames: z.array(z.string()).optional(),
    /** Workflows whose required dependent fields a sync left for the target to re-pick. */
    needsConfiguration: z.array(forkNeedsConfigurationSchema).optional(),
    /** Workflows whose optional dependent fields a sync cleared (FYI, non-blocking). */
    clearedOptional: z.array(forkNeedsConfigurationSchema).optional(),
    /** How many source-deleted references the operator explicitly dropped in this sync. */
    droppedReferences: z.number().int().optional(),
    /** How many public trigger URLs this sync stopped serving. */
    triggerUrlChanges: z.number().int().optional(),
  })
  .nullable()
export const backgroundWorkItemSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  workflowId: z.string().nullable(),
  kind: z.enum(['deployment_side_effects', 'fork_content_copy', 'fork_sync', 'fork_rollback']),
  status: z.enum(['pending', 'processing', 'completed', 'completed_with_warnings', 'failed']),
  message: z.string().nullable(),
  error: z.string().nullable(),
  metadata: backgroundWorkMetadataSchema,
  startedAt: z.string(),
  completedAt: z.string().nullable(),
})
export type BackgroundWorkMetadata = z.output<typeof backgroundWorkMetadataSchema>
/** Keyset pagination inputs, mirroring the audit log's (`auditLogsQuerySchema`). */
export const getWorkspaceBackgroundWorkQuerySchema = z.object({
  /** Opaque cursor from a prior page's `nextCursor`; omit for the first page. */
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((value) => Math.min(Math.max(Number(value) || 50, 1), 100)),
})
export const getWorkspaceBackgroundWorkContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/background-work',
  params: workspaceIdParamsSchema,
  query: getWorkspaceBackgroundWorkQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      items: z.array(backgroundWorkItemSchema),
      /** Opaque keyset cursor for the next page; null when this page is the last. */
      nextCursor: z.string().nullable(),
    }),
  },
})
export type BackgroundWorkItem = z.output<typeof backgroundWorkItemSchema>
export type GetWorkspaceBackgroundWorkResponse = z.output<
  typeof getWorkspaceBackgroundWorkContract.response.schema
>

export const rollbackForkBodySchema = z.object({
  otherWorkspaceId: workspaceIdSchema,
})
export const rollbackForkContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/fork/rollback',
  params: workspaceIdParamsSchema,
  body: rollbackForkBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      restored: z.number().int(),
      archived: z.number().int(),
      unarchived: z.number().int(),
      /** Snapshot workflows that no longer exist and couldn't be reactivated. */
      skipped: z.number().int(),
      /**
       * Workflows whose restored version has not finished its activation
       * cutover; the undo point is preserved so the rollback can be re-run.
       */
      pendingActivations: z.array(z.string()),
    }),
  },
})
export type RollbackForkBody = z.input<typeof rollbackForkBodySchema>
export type RollbackForkResponse = z.output<typeof rollbackForkContract.response.schema>

export const getForkAvailabilityContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/fork/availability',
  params: workspaceIdParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      /** Server-evaluated verdict of the fork gate: env/plan + AppConfig rollout flag. */
      available: z.boolean(),
    }),
  },
})
export type GetForkAvailabilityResponse = z.output<
  typeof getForkAvailabilityContract.response.schema
>

export const unlinkForkBodySchema = z.object({
  otherWorkspaceId: workspaceIdSchema,
})
export const unlinkForkContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/fork/unlink',
  params: workspaceIdParamsSchema,
  body: unlinkForkBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      /** False when the edge was already dissolved by a concurrent unlink (idempotent no-op). */
      unlinked: z.boolean(),
    }),
  },
})
export type UnlinkForkBody = z.input<typeof unlinkForkBodySchema>
export type UnlinkForkResponse = z.output<typeof unlinkForkContract.response.schema>

export const updateForkExcludedWorkflowsBodySchema = z.object({
  /** Workflows to mark or unmark; ids outside the workspace are ignored. */
  workflowIds: z
    .array(z.string().min(1, 'workflowIds entries cannot be empty'))
    .min(1, 'workflowIds cannot be empty')
    .max(1000, 'Cannot update more than 1000 workflows at once'),
  /** True marks the workflows "Exclude from sync"; false includes them again. */
  forkSyncExcluded: z.boolean(),
})
export const updateForkExcludedWorkflowsContract = defineRouteContract({
  method: 'PUT',
  path: '/api/workspaces/[id]/fork/excluded-workflows',
  params: workspaceIdParamsSchema,
  body: updateForkExcludedWorkflowsBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      /** Number of workflows actually updated (ids outside the workspace are skipped). */
      updated: z.number().int(),
    }),
  },
})
export type UpdateForkExcludedWorkflowsBody = z.input<typeof updateForkExcludedWorkflowsBodySchema>
export type UpdateForkExcludedWorkflowsResponse = z.output<
  typeof updateForkExcludedWorkflowsContract.response.schema
>
