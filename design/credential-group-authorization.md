# Credential Group Authorization

Status: actor-only enforcement and group-wide resource grants are implemented

## Purpose

Credential Groups collect external users' managed credentials and let workflows select the credentials they are authorized to use. They are not general-purpose membership or authorization groups.

The default is simple:

> An execution may list every non-secret credential reference, but it may use only the verified actor's credential.

Explicit resource-policy grants can expand a user, Access Control Group, workspace role, or deployed workflow to every credential in the Credential Group.

## Credential identity

Each managed credential has an opaque `credential.id` independent of Sim user ownership. It is linked to one enrollment and one provider option:

```text
credential_group
  -> credential_group_enrollment
      -> credential_group_option
          -> credential.id
```

`credential.createdBy` is audit metadata and is never used for authorization.

An enrollment represents one person in one Credential Group. Email can bootstrap or connect an enrollment, but runtime external identity uses stable provider identifiers whenever available:

```text
(provider, tenantId, subjectId)
  -> credential-group enrollment
  -> option-specific credential ID
```

For a verified Sim user, the current implementation resolves:

```text
Principal userId
  -> verified normalized Sim email
  -> active enrollment with the same normalized email
```

For Slack, the implementation resolves:

```text
verified webhook Principal subject (slack, teamId, userId)
  -> active enrollment
```

Email is not accepted from workflow input for authorization.

## One block operation

The Credential Group block keeps one operation:

```text
List Credentials
```

Its contract is:

> Return every active credential reference in the group; selecting a reference does not authorize its use.

Inputs may select the Credential Group, provider option, and pagination. Inputs never select identity or authorization scope:

```ts
interface ListCredentialGroupCredentialsInput {
  credentialGroupId: string
  credentialProviderIds?: string[]
  limit: number
  cursor?: string
}
```

The input does not contain:

- email;
- user ID;
- enrollment ID;
- credential ID;
- `all` or `scope` flags.

## List authorization

The application operation loads the canonical Credential Group, verifies executor delegation, workspace binding, group scope, status, and entitlement, then returns a bounded page of all active credential references in the group. The result contains opaque IDs and account metadata but no token material, and a returned credential ID is never an authorization capability.

## Credential use authorization

OAuth token material is resolved only inside a protected application operation. Every use performs a fresh authorization check:

```text
credential belongs to the actor's active enrollment
OR
execution matches a current credentials.use grant on the Credential Group
```

The credential must also be:

- in the canonical requested Credential Group;
- linked to an active enrollment and active provider option;
- active and usable;
- for the expected provider;
- granted all scopes required by the tool.

Tokens and refresh tokens never appear in block output or execution logs. List results return opaque credential references and bounded account metadata only.

## Resource-policy grants

The Credential Group resource policy can grant:

```text
credential_groups.credentials.use
```

Example workflow grant:

```json
{
  "id": "support-workflow-credentials",
  "subject": {
    "type": "workflow",
    "workflowId": "wf_support"
  },
  "actions": ["credential_groups.credentials.use"]
}
```

The stable `workflowId` is the policy key. It matches only a canonically deployed execution. The deployment ID is carried for proof and audit but is not stored in the policy, so deploying a new version does not break the grant.

Example Access Control Group grant:

```json
{
  "id": "support-admin-credentials",
  "subject": {
    "type": "access_control_group",
    "accessControlGroupId": "pg_support_admins"
  },
  "actions": ["credential_groups.credentials.use"]
}
```

Membership is evaluated at operation time. Removing a user from the Access Control Group revokes access immediately on the next protected operation.

## Execution behavior

All executions that pass the list operation's workspace and group checks can see the same credential references. Using a selected credential resolves as follows:

| Execution | Credential use result |
| --- | --- |
| Manual actor without an explicit grant | Actor's enrollment only |
| Manual actor in a granted Access Control Group | All credentials |
| Manual draft relying only on a workflow grant | Actor's enrollment only |
| Deployed workflow with a workflow grant | All credentials |
| Deployed workflow with an actor but no workflow grant | Actor's enrollment only |
| Actorless schedule with a workflow grant | All credentials |
| Actorless schedule without a workflow grant | Fail |
| Actor with no enrollment and no explicit grant | Fail |

There is no silent fallback from a requested all-credentials mode because the block has no caller-controlled access mode. Authorization happens when the selected credential is assumed.

Manual testing exercises the actor path with the tester's credential. Full group-wide behavior is tested through a deployed execution, preferably against a staging Credential Group in a forked workspace.

## Slack-triggered execution

Slack actor access requires a verified nested subject in the workflow execution Principal:

```text
Slack signature and installation verified
  -> webhook Principal with (teamId, userId) subject
  -> workflow execution
  -> Credential Group enrollment resolution
  -> actor-scoped credential use
```

The Slack trigger subscription credential only receives events. It is not the external user's downstream credential.

Bot events and events without a verified human subject have no actor. They require an explicit deployed-workflow grant for group-wide access or fail.

## Management boundary

Credential Group creation, options, invitations, enrollment lifecycle, and resource-policy changes remain control-plane operations requiring current workspace-admin authorization and audit.

Managing the policy does not automatically grant the administrator permission to use credentials. Data-plane credential use still requires actor ownership or an explicit grant.

## Current implementation delta

The branch:

- threads the original Principal into Credential Group executor delegation;
- removes caller-supplied email filtering from credential listing;
- resolves a verified Sim user to an exact active enrollment;
- lists bounded non-secret references for every active credential in the group;
- rechecks the same enrollment when resolving managed OAuth tokens;
- fails actorless execution instead of substituting a billing or workflow owner.
- stores and evaluates generic allow-only resource policies;
- resolves user, workspace-role, Access Control Group, external-identity, and deployed-workflow subjects;
- grants whole-group credential use when an explicit policy matches;
- binds Slack's verified provider subject to an active enrollment;
- exposes an audited, optimistic-concurrency admin management API and structured Access tab.

Knowledge Base/table resource enforcement and provenance-aware log redaction remain separate follow-up work.
