# Resource Archive Policy

## Purpose

This document defines the current lifecycle policy for resource deletion in Sim.

The system uses two different concepts:

- Root-resource archive: preserves the root row and disables or archives its owned graph.
- Direct child delete: removes a child resource directly instead of preserving it for restore.

The intent is a snapshot-style archive model:

- Archiving a root resource preserves the root and its archive-time graph.
- Directly deleting a child resource does not create restoreable archive state.
- Cleanup and rollback paths should not leave soft-deleted child rows behind.

## Root Resources

The current soft-deletable roots are:

- `workspace` via `workspace.archivedAt`
- `workflow` via `workflow.archivedAt`
- `knowledge_base` via `knowledgeBase.deletedAt`
- `user_table_definitions` via `userTableDefinitions.archivedAt`
- `workspace_files` metadata via `workspaceFiles.deletedAt`

These roots are hidden from normal active reads by default and can be surfaced through explicit archive-aware scopes where supported.

## Policy Rules

### 1. Root archive

When a root resource is archived:

- The root row remains.
- User-facing discovery and runtime execution paths treat the resource as inactive.
- Parent-owned descendants are archived or disabled as part of the same snapshot boundary.
- History and logs for the archived root remain intentionally readable where the product expects them.

### 2. Direct child delete

When a non-root child is explicitly deleted by the user:

- The child is hard deleted unless there is an existing intentional product-specific tombstone model.
- The delete should not be converted into parent-style archive semantics.
- Future restore of the parent must not revive that child.

### 3. Cleanup and rollback

Cleanup flows should prefer hard delete semantics for non-root child data:

- failed setup
- rollback
- connector reconciliation when a source item disappears
- in-flight cleanup after a direct child delete

### 4. Read-side default

Normal reads should only surface active resources:

- archived roots are excluded
- archived descendants are excluded
- directly deleted descendants are excluded

## Resource Graphs

## Workspace graph

Root:

- `workspace`

Owned archive cascade:

- `workflow`
- `knowledge_base`
- `user_table_definitions`
- `workspace_files`
- `workflow_mcp_server`
- `mcp_servers`
- `workflow_schedule` rows owned at the workspace layer
- `workspace_notification_subscription` disabled
- `workspace_invitation` cancelled
- workspace-scoped `api_key` hard deleted

Notes:

- Workspace archive is implemented as a parent-driven lifecycle operation.
- Child workflows and KBs are archived through their own graph rules.
- Workspace archive should suppress runtime activity and notifications.

## Workflow graph

Root:

- `workflow`

Owned archive cascade:

- `workflow_schedule`
- `webhook`
- `chat`
- `form`
- `workflow_mcp_tool`
- `a2a_agent`
- deployment versions deactivated
- public execution surfaces disabled

Notes:

- Direct delete of these child resources remains hard delete where supported by product behavior.
- Workflow archive must also shut down runtime behavior such as schedules, public endpoints, and deployed integrations.

## Knowledge base graph

Root:

- `knowledge_base`

Owned archive cascade:

- `document`
- `knowledge_connector`

Child lifecycle markers:

- `knowledge_base.deletedAt` marks the archived KB root
- `document.archivedAt` marks a document archived because its parent KB or workspace was archived
- `document.deletedAt` marks a directly deleted document
- `knowledge_connector.archivedAt` marks a connector archived because its parent KB or workspace was archived
- `knowledge_connector.deletedAt` is reserved for direct-delete style removal semantics

Notes:

- The KB graph intentionally uses a split child marker model.
- This allows future KB restore to clear `archivedAt` without reviving children that were directly deleted.

## Table graph

Root:

- `user_table_definitions`

Owned archive cascade:

- table definition row archived
- table row data remains tied to the archived table definition lifecycle

Notes:

- Direct table delete is treated as root archive because the table itself is a root resource.

## Workspace file graph

Root:

- `workspace_files` metadata row

Owned archive cascade:

- file metadata is soft deleted through `deletedAt`
- read paths should no longer authorize or list deleted file rows

Notes:

- This is a root resource even though the underlying blob may continue to exist until a later purge.

## Archive vs hard delete matrix

Archive the root and its graph:

- deleting a workspace
- deleting a workflow
- deleting a knowledge base
- deleting a table
- deleting a workspace file root record

Hard delete the child directly:

- deleting a KB document directly
- bulk deleting KB documents directly
- deleting a KB connector directly
- deleting a KB chunk directly
- deleting KB tag definitions directly
- deleting workflow child resources directly when they are not roots
- cleanup or rollback of non-root child resources

Disable rather than preserve active behavior:

- schedule execution
- webhook routing
- chat/form public access
- MCP/A2A discovery
- notification sending

## KB-specific rules

### Parent archive

When a KB is archived through KB or workspace lifecycle:

- the KB root gets `deletedAt`
- child documents get `archivedAt`
- child connectors get `archivedAt`
- read/search/VFS/file-auth surfaces must treat those children as inactive

### Direct document delete

When a document is deleted directly:

- the document row is hard deleted
- its embeddings are hard deleted
- its stored file is deleted best-effort
- this does not create restoreable archive state

### Direct connector delete

When a connector is deleted directly:

- the connector row is hard deleted
- its synced documents are hard deleted
- sync logs are removed by relational cascade

### Connector exclusion

Connector exclusion is separate from deletion:

- `userExcluded` is the product tombstone for "keep this source item out of the KB"
- delete is not used as the exclusion signal
- restore of excluded connector documents should operate on exclusion state, not parent archive state

## Read-side expectations

These surfaces should only expose active KB children:

- KB document APIs
- KB connector APIs
- KB search
- copilot KB context and VFS
- selector validation
- KB file authorization
- tag usage and cleanup calculations
- connector sync scheduling and execution

## Restore expectations

Future restore should follow these rules:

- restoring a root should only restore children archived as part of that root archive snapshot
- restoring a root must not revive directly deleted children
- KB restore should clear child `archivedAt`, not child `deletedAt`

## Purge expectations

Hard purge is intentionally separate from archive:

- archive preserves rows and history
- purge can later remove archived roots and retained blobs permanently
- logs and history should remain resolvable for archived resources until purge requirements say otherwise
