# Credential Group Authorization

Status: actor-only enforcement is implemented; group-wide resource grants are proposed

## Purpose

Credential Groups collect external users' managed credentials and let workflows select the credentials they are authorized to use. They are not general-purpose membership or authorization groups.

The default is simple:

> An execution with a verified actor may list and use only that actor's credentials.

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

For Slack, the next step is:

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

> Return every credential that this execution is currently authorized to use.

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

The application operation loads the canonical Credential Group, verifies workspace access, and evaluates the current resource policy.

```text
matching credentials.list grant
  -> list all active credentials in the group

otherwise verified actor with active enrollment
  -> list only credentials for that exact enrollment

otherwise
  -> fail
```

The internal result is a database query constraint, not persisted policy state:

```ts
type CredentialListAuthorization =
  | { enrollmentId: string }
  | { grantId: string }
```

The exact enrollment constraint is applied to cursor validation and every page query. A credential ID returned from an earlier call is not an authorization capability.

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
credential_groups.credentials.list
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
  "actions": [
    "credential_groups.credentials.list",
    "credential_groups.credentials.use"
  ]
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
  "actions": [
    "credential_groups.credentials.list",
    "credential_groups.credentials.use"
  ]
}
```

Membership is evaluated at operation time. Removing a user from the Access Control Group revokes access immediately on the next protected operation.

## Execution behavior

| Execution | Result |
| --- | --- |
| Manual actor without an explicit grant | Actor's enrollment only |
| Manual actor in a granted Access Control Group | All credentials |
| Manual draft relying only on a workflow grant | Actor's enrollment only |
| Deployed workflow with a workflow grant | All credentials |
| Deployed workflow with an actor but no workflow grant | Actor's enrollment only |
| Actorless schedule with a workflow grant | All credentials |
| Actorless schedule without a workflow grant | Fail |
| Actor with no enrollment and no explicit grant | Fail |

There is no silent fallback from a requested all-credentials mode because the block has no caller-controlled access mode. It simply returns the set authorized for the current execution.

Manual testing exercises the actor path with the tester's credential. Full group-wide behavior is tested through a deployed execution, preferably against a staging Credential Group in a forked workspace.

## Slack-triggered execution

Slack actor access requires a verified nested subject in the workflow execution Principal:

```text
Slack signature and installation verified
  -> webhook Principal with (teamId, userId) subject
  -> workflow execution
  -> Credential Group enrollment resolution
  -> actor-scoped credential list/use
```

The Slack trigger subscription credential only receives events. It is not the external user's downstream credential.

Bot events and events without a verified human subject have no actor. They require an explicit deployed-workflow grant for group-wide access or fail.

## Management boundary

Credential Group creation, options, invitations, enrollment lifecycle, and resource-policy changes remain control-plane operations requiring current workspace-admin authorization and audit.

Managing the policy does not automatically grant the administrator permission to list or use credentials. Data-plane access still requires actor ownership or an explicit grant.

## Current implementation delta

The branch already:

- threads the original Principal into Credential Group executor delegation;
- removes caller-supplied email filtering from credential listing;
- resolves a verified Sim user to an exact active enrollment;
- filters list pagination by that enrollment;
- rechecks the same enrollment when resolving managed OAuth tokens;
- fails actorless execution instead of substituting a billing or workflow owner.

Remaining work is:

1. Add the generic resource-policy store and evaluator.
2. Resolve user, workspace-role, Access Control Group, and deployed-workflow subjects.
3. Extend list authorization to actor enrollment or a `credentials.list` grant.
4. Extend token authorization to actor ownership or a `credentials.use` grant.
5. Bind Slack's verified nested external subject to the matching enrollment.
6. Add admin policy management and audit surfaces.
