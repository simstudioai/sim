# TODOS

## API / Permissions

### Align the v1 deployment surface with the operation registry
**Priority:** P1

`workflowOperations.deploy/undeploy/activateVersion/revertVersion` all declare
`workspaceApiKey: 'deny'`, but `resolveV1DeploymentWorkflow`
(`apps/sim/app/api/v1/workflows/utils.ts`) predates the registry and runs its own
`validateWorkspaceAccess`, which resolves a workspace API key to its creator's
permission. A workspace key therefore deploys through v1 regardless of the
declared deny.

Pre-existing, not introduced by the deploy-requires-write branch — but that
branch lowered the bar from `admin` to `write`, so a key created by an admin who
was later demoted to editor now keeps working where it previously stopped.

Fixing it is a breaking change for anyone deploying via v1 with a workspace key,
so it needs its own release note and deprecation window rather than riding along
in a permissions PR.

Noted in: `apps/sim/lib/core/application/deployment-permission-matrix.test.ts`
(scope note on the `workspaceApiKey` describe block).

### Route the deployment tool routes through the operation registry
**Priority:** P3

`apps/sim/app/api/tools/deployments/{deploy,promote,undeploy}/route.ts` call
`authorizeDeploymentWorkflow(..., 'write')` with a hardcoded role literal instead
of consuming `workflowOperations.deploy.minimumRole`. A future change to the
central `minimumRole` leaves these three routes at a stale value. They also sit
outside the operation's `principalKinds` policy.

### Route the workflow MCP server routes through their application use cases
**Priority:** P2

`apps/sim/app/api/mcp/workflow-servers/route.ts` (POST) and
`apps/sim/app/api/mcp/workflow-servers/[id]/route.ts` (PATCH) call
`performCreateWorkflowMcpServer` / `performUpdateWorkflowMcpServer` directly
instead of going through `createWorkflowMcpDeploymentServer` /
`updateWorkflowMcpDeploymentServer`. Everything those use cases declare —
`minimumRole`, `workspaceApiKey`, `principalKinds`, the delegation policy, and
semantic audit — is bypassed on the primary UI path.

This already cost us one real hole: the admin-only public-exposure gate was
added to the use cases and silently did not cover the settings UI, so a `write`
member could publish an unauthenticated MCP server. The gate is now duplicated
into both routes (see the TSDoc at each callsite) — that closes the hole but
leaves two copies of a security rule, which is exactly what
`.claude/rules/global.md` "Application Operation Boundary" forbids.

Migrating needs `withMcpAuth`'s `{ userId, workspaceId }` context to become a
`Principal` (these routes accept MCP API-key auth, not just sessions), so it is
a real refactor rather than a mechanical swap. Delete the duplicated gates when
it lands.

### Add `mship-tools:check` to CI
**Priority:** P2

`apps/sim/lib/copilot/generated/tool-catalog-v1.ts` is generated from the
mothership contract and enforced at runtime by
`apps/sim/lib/copilot/tool-executor/executor.ts`. Nothing in CI verifies it is in
sync, so a regeneration from a stale sibling checkout can silently revert tool
permissions. The sim-side catalog currently carries schema bounds that
mothership's committed contract does not, so regeneration is not byte-stable in
either direction until the mothership side lands.

## Completed
