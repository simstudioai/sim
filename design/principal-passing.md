# Workflow Principal Passing

Status: proposed design, with the initial Principal transport already implemented

## Goal

Authenticate once at the execution surface and preserve that identity through the complete workflow lifecycle. Billing attribution, workflow ownership, and external-provider identity remain separate facts and never replace the authenticated caller.

The execution identity must survive:

- synchronous, streaming, and asynchronous execution;
- queues and worker handoff;
- pause, resume, and retry;
- regular subworkflows and workflow tools;
- short-lived internal executor delegation;
- credential and future resource authorization.

## Identity model

The execution carries the original Principal together with trusted workflow binding:

```ts
interface WorkflowExecutionIdentityV1 {
  version: 1
  invoker: WorkflowExecutionPrincipal
  root: {
    workflowId: string
    executionId: string
  }
  currentWorkflow: {
    workflowId: string
    mode: 'draft' | 'deployment'
    deploymentVersionId?: string
  }
}
```

These fields have different meanings:

- `invoker` identifies the authenticated surface and any verified subject that caused the invocation.
- `root` is immutable execution causality and recursion context.
- `currentWorkflow` identifies the code currently exercising resource permissions.
- `deploymentVersionId` proves canonical deployed execution but is not a resource-policy key.

A draft has workflow context but no workflow resource authority. A resource-policy workflow subject matches only when `currentWorkflow.mode` is `deployment` and the deployment binding is canonical.

## External subjects

An external user asserted by an authenticated provider is a subject of the invocation Principal, not an independent Sim Principal:

```ts
interface ExternalUserSubject {
  kind: 'external_user'
  provider: string
  tenantId: string
  subjectId: string
}

interface WebhookSystemPrincipal {
  kind: 'system'
  serviceId: 'webhook'
  workspaceId: string
  workflowId: string
  webhookId: string
  provider: string
  subject?: ExternalUserSubject
}
```

For Slack, the webhook signature and canonical installation authenticate the invocation. Slack's stable team and user identifiers become the verified subject:

```ts
{
  kind: 'system',
  serviceId: 'webhook',
  workspaceId: 'ws_support',
  workflowId: 'wf_support',
  webhookId: 'wh_slack_support',
  provider: 'slack',
  subject: {
    kind: 'external_user',
    provider: 'slack',
    tenantId: 'T123',
    subjectId: 'U456',
  },
}
```

The subject cannot independently authorize workspace operations. It is available only inside the trusted execution for actor-scoped credential and resource decisions.

Events without a verified human subject omit `subject`. Sim never substitutes a workflow owner, workspace owner, or billing owner.

## Subject resolution

Application authorization uses a single resolver:

```ts
type PrincipalSubject =
  | { kind: 'sim_user'; userId: string }
  | ExternalUserSubject

function resolvePrincipalSubject(principal: Principal): PrincipalSubject | null
```

- Sessions, personal API keys, and human-subject delegations resolve to `sim_user`.
- Verified Slack and other external events resolve to `external_user`.
- Workspace API keys, schedules, anonymous public requests, and actorless webhooks resolve to `null`.
- Human-only operations fail when the result is `null`.

## Surface construction

Every execution surface constructs the Principal before business execution:

```text
session/manual       -> SessionPrincipal
personal API key     -> PersonalApiKeyPrincipal
workspace API key    -> WorkspaceApiKeyPrincipal
Copilot              -> delegated Copilot Principal
schedule             -> system schedule Principal without a subject
Slack webhook        -> system webhook Principal with an optional verified subject
anonymous public API -> system public-api Principal without a subject
```

Provider payload fields are not trusted merely because they appear in workflow input. The provider adapter attaches a subject only after authenticating the request and validating the canonical provider installation.

## Execution transport

`WorkflowExecutionIdentityV1` is required in execution metadata and is forwarded through every trusted transport:

```text
surface
  -> application execute operation
  -> preprocessing
  -> execution service
  -> queue payload or synchronous executor
  -> execution metadata
  -> execution context
  -> internal delegation
  -> protected application operation
```

The same identity is preserved through pause snapshots and resume. The Principal authorizing a later resume command is audit causality only; it does not overwrite the original execution identity.

## JSON codec

Queues and snapshots store JSON, so the execution identity uses one strict, versioned codec in the auth package:

```ts
serializeWorkflowExecutionIdentity(identity): SerializedWorkflowExecutionIdentityV1
parseWorkflowExecutionIdentity(value): WorkflowExecutionIdentityV1
```

The codec:

- rejects unknown versions, fields, kinds, and malformed timestamps;
- restores `Date` values exactly;
- never persists invitation tokens, OAuth tokens, session cookies, or bearer headers;
- rejects Principal kinds that are invalid for durable execution;
- does not contain fallback parsing for malformed records.

The serialized value lives inside existing queue JSON and snapshot JSON. The codec is application code, not a database function or separate database object.

## Internal executor delegation

Short-lived executor tokens prove that a protected call originated from a canonical active execution. They are transport credentials, not frozen resource grants.

The current mandatory `subjectUserId` model must be replaced with the complete execution identity or an optional resolved subject. Actorless and external-subject executions must never be represented using the billing user.

At each protected operation, Sim binds the token to the canonical execution and workspace, then loads current authorization state. Revoking workspace access, Access Control Group membership, or a resource grant takes effect on the next operation.

## Nested workflows

Regular subworkflows preserve `invoker` and `root`, but replace `currentWorkflow` while the child runs:

```text
parent block executes -> currentWorkflow = parent
enter child           -> currentWorkflow = child
return from child     -> currentWorkflow = parent
```

Resource policies match `currentWorkflow.workflowId`; parent grants do not spread transitively into the child. The original human or external subject remains available for actor-scoped access throughout the chain.

Published custom blocks are an intentional authority boundary. They retain invocation causality but rebase effective workflow authority, workspace, payer, and delegation origin to the published source workflow.

## Billing and audit

Billing attribution is stored separately from execution identity:

```ts
{
  identity: WorkflowExecutionIdentityV1,
  billingAttribution: BillingAttributionSnapshot,
}
```

Audit records can show both the invocation surface and verified subject. A Slack-triggered run is attributed to the Slack webhook and Slack user; it is never recorded as though the workspace billing owner initiated it.

## Current implementation delta

The branch carries a versioned Principal through execution metadata, workers, snapshots, nested workflows, and tool execution. It also carries verified Slack subjects and supports executor delegation without inventing a billing-owner subject.

Internal delegation now preserves immutable root causality separately from the current workflow. Deployed workflow authority is bound to the active deployment version at every internal application call, while resource policies retain the stable workflow ID as their key.

A future cleanup can combine these currently separate trusted fields into one explicit execution-identity envelope. That is a representation cleanup, not a prerequisite for Credential Group resource-policy enforcement.
