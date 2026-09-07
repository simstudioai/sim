import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

/**
 * Semantic operation for running one code-defined tool directly.
 *
 * The verb the catalog deliberately does not carry. `catalog.tools.read`
 * describes which tools exist; its own policy comment says whether a member may
 * call one "is decided on that tool's own operation", and this is it. Kept in
 * its own domain rather than beside the catalog reads because execution reaches
 * the executable tool registry, which every catalog module is guarded against.
 *
 * `write` rather than `read`: a tool call sends the mail, opens the issue, posts
 * the message. Nothing about it is a read, and `read` is the floor of the role
 * ordering, so declaring it there would mean the operation could never refuse a
 * member for their role at all.
 *
 * `workspaceApiKey: 'deny'`, matching `selectors.execute` and
 * `mcp_servers.tools.execute`, the two shipped operations that reach a third
 * party on the caller's behalf. The call resolves this principal's credentials
 * and this principal's secrets, and a workspace key stands for no person — so
 * there would be no one to hold accountable for what was sent, and the
 * per-integration gate below would have no subject to judge.
 *
 * `session` is declared alongside the personal key even though v2 authenticates
 * only API keys today. It is the kind an internal route or the Copilot adapter
 * arrives as, and the role and key policy are already the ones those surfaces
 * need — the same reason the workflow-MCP operations admit the human principal
 * kinds ahead of a surface that uses them.
 */
export const toolExecutionOperations = {
  // permission-group-exempt: declares capability: 'none' because no static capability names running one built-in tool — the per-tool denial is the deniedTools key, applied inside @/tools against the resolved id, and the per-integration denial is the parameterized allowedIntegrations key, which the funnel cannot apply because it never sees which integration a tool id reaches. That decision is enforced from the use case by the owning-block-type check in executeToolForCaller, ahead of dispatch.
  execute: defineWorkspaceOperation({
    id: 'tools.execute',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    capability: 'none',
  }),
} as const
