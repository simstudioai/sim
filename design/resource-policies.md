# Resource Policies

Status: proposed reusable authorization model

## Goal

Resource policies add data-plane authorization to individual Sim resources without replacing workspace roles or organizational Access Controls.

The same model starts with Credential Groups and later extends to Knowledge Bases, tables, files, and other protected resources.

## Responsibilities

The authorization layers answer different questions:

```text
workspace role
  -> may this caller operate in the workspace?

Access Control boundary
  -> may this actor or workflow use this integration, model, or tool category?

resource policy
  -> may this subject perform this action on this specific resource?
```

The effective decision requires every applicable layer:

```text
workspace authorization
AND actor Access Control boundary
AND current workflow execution boundary
AND resource authorization
```

A resource grant never overrides an Access Control restriction.

## Policy format

The first version is allow-only and exact:

```ts
interface ResourcePolicyV1 {
  version: 1
  resource: {
    type: ResourceType
    id: string
  }
  grants: ResourcePolicyGrant[]
}

interface ResourcePolicyGrant {
  id: string
  subject: ResourcePolicySubject
  actions: string[]
}
```

The first version intentionally has no:

- explicit deny;
- wildcard resources or actions;
- arbitrary conditions;
- precedence rules;
- persisted access scope;
- workflow deployment-version key.

Each protected application operation names one exact resource and action.

## Subjects

```ts
type ResourcePolicySubject =
  | { type: 'user'; userId: string }
  | { type: 'workspace_role'; minimumRole: 'read' | 'write' | 'admin' }
  | { type: 'access_control_group'; accessControlGroupId: string }
  | { type: 'workflow'; workflowId: string }
  | {
      type: 'external_identity'
      provider: string
      tenantId: string
      subjectId: string
    }
```

Policies store stable subject references, never session IDs, API keys, delegation IDs, emails, or serialized bearer credentials.

## Example Credential Group policy

```json
{
  "version": 1,
  "resource": {
    "type": "credential_group",
    "id": "cg_support"
  },
  "grants": [
    {
      "id": "support-workflow",
      "subject": {
        "type": "workflow",
        "workflowId": "wf_support"
      },
      "actions": [
        "credential_groups.credentials.list",
        "credential_groups.credentials.use"
      ]
    },
    {
      "id": "support-admins",
      "subject": {
        "type": "access_control_group",
        "accessControlGroupId": "pg_support_admins"
      },
      "actions": [
        "credential_groups.credentials.list",
        "credential_groups.credentials.use"
      ]
    }
  ]
}
```

An explicit grant on a Credential Group covers the whole group. Credential Group actor-only access is a built-in domain invariant, not a policy statement or scope value.

## Example Knowledge Base policy

```json
{
  "version": 1,
  "resource": {
    "type": "knowledge_base",
    "id": "kb_finance"
  },
  "grants": [
    {
      "id": "finance-team-read",
      "subject": {
        "type": "access_control_group",
        "accessControlGroupId": "pg_finance"
      },
      "actions": [
        "knowledge_bases.read",
        "knowledge_bases.search"
      ]
    },
    {
      "id": "finance-agent-read",
      "subject": {
        "type": "workflow",
        "workflowId": "wf_finance_agent"
      },
      "actions": [
        "knowledge_bases.read",
        "knowledge_bases.search"
      ]
    }
  ]
}
```

## Default behavior

Resources remain open under their existing workspace-role behavior until a restrictive policy is attached. Once attached, unmatched subjects cannot perform the protected data action, including workspace administrators.

Resource types may define a narrowly scoped built-in rule where required. Credential Groups always retain actor access to that actor's own enrollment; their policy only adds broader grants.

Workspace administrators can manage policies through audited control-plane operations. Policy-management authority does not imply data-read authority.

## Runtime subject resolution

The evaluator receives trusted execution context and resolves current subjects:

```ts
interface ResourceAuthorizationContext {
  workspaceId: string
  invoker: Principal
  principalSubject: PrincipalSubject | null
  workspaceRole?: 'read' | 'write' | 'admin'
  accessControlGroupId?: string
  currentWorkflow?: {
    workflowId: string
    mode: 'draft' | 'deployment'
    deploymentVersionId?: string
  }
}
```

Subject matching is exact:

- `user` matches a canonical Sim user subject.
- `workspace_role` matches a current role at or above `minimumRole`.
- `access_control_group` matches the user's current effective Access Control Group for this workspace.
- `external_identity` matches a verified nested provider subject.
- `workflow` matches only the canonically deployed `currentWorkflow.workflowId`.

Draft workflow context never matches a workflow subject. A bare workflow ID supplied by a block, tool, or request is not authority.

## Access Control Groups

Existing Access Control Groups remain organization governance groups. Their current restrictions define a maximum capability boundary for users. They can also serve as stable subjects in resource policies.

The policy remains stored on the resource. The Access Control Group UI may show a Resources view by querying policies that reference the group, but it does not store a second copy.

Membership and workspace targeting are evaluated live. A group must belong to the resource's organization and apply to the resource workspace when a grant is created and when it is evaluated.

Workflows do not implicitly inherit a human Access Control Group. Deployed workflows receive their own execution boundary and explicit resource grants.

## Workflow authority and subworkflows

Workflow policies target a stable `workflowId`, so upgrades retain grants. Runtime authorization additionally requires canonical deployed-workflow proof.

The execution carries both root and current workflow identity:

```text
root workflow     -> audit, causality, recursion
current workflow  -> resource-policy matching
```

When a subworkflow runs, resource grants switch to the child workflow. Parent grants do not flow transitively. The original actor Principal and Access Control boundary remain in force.

## Storage

Use a generic resource-policy table rather than adding unrelated policy JSON columns to every resource:

```text
resource_policy
  id
  workspace_id
  resource_type
  resource_id
  version
  document_json
  created_by
  created_at
  updated_at
```

The table has one active policy per `(resource_type, resource_id)` and an index on `workspace_id`. Application use cases validate canonical resource ownership before reads or writes.

If reverse queries such as "all resources granted to this Access Control Group" become frequent, add a normalized grant-subject index derived transactionally from the policy document. The policy document remains the single source of truth.

Policy writes require current workspace-admin authorization, exact schema validation, semantic audit, and optimistic concurrency through the current policy version or update timestamp.

## Enforcement boundary

Every protected resource operation enters through its authorized application use case:

```text
authenticate Principal
  -> load canonical resource and workspace
  -> authorize current workspace access
  -> apply actor and workflow Access Control boundaries
  -> load current resource policy
  -> match exact subject and action
  -> execute repository or manager operation
  -> emit semantic audit
```

Routes, blocks, tools, Copilot adapters, and executor handlers do not query policy tables or make independent authorization decisions.

## Provenance and logs

Future protected resources attach provenance to values returned into workflow execution:

```ts
{
  resourceType: 'knowledge_base',
  resourceId: 'kb_finance',
  action: 'knowledge_bases.read'
}
```

Tool inputs, outputs, and log fields retain the provenance transitively. When a viewer reads execution logs, Sim reevaluates current resource access and redacts values derived from resources the viewer cannot read.

Credential secrets remain stronger: token material is never inserted into logs or ordinary block output regardless of viewer permission.

Provenance and viewer-specific log shielding are a later phase. They use the same policy evaluator but are not required for the first Credential Group resource-policy implementation.

## Initial implementation order

1. Add strict policy types, validation, storage, and evaluator.
2. Add admin policy read/write application operations and audit.
3. Add deployed-workflow authority to execution identity.
4. Integrate Credential Group list and use authorization.
5. Add user, workspace-role, and Access Control Group subject resolution.
6. Add policy management UI on Credential Groups.
7. Extend the same evaluator to Knowledge Bases and tables.
8. Add resource provenance and viewer-specific log shielding.
