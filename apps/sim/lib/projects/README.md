# Project creation

A Project groups environments. An environment is an existing `workspace` record; there is no separate environment table. Every newly created Project starts with an environment.

Project APIs return HTTP 503 until the deployment enables `PROJECT_API_ENABLED`. Automatic assignment on legacy workspace creation requires `PROJECT_WRITES_ENABLED`; both server controls default off. The API requires writers to be enabled. Existing assigned Projects always retain their lifecycle protections, including fork inheritance and disconnect behavior, even if activation is disabled.

## Choose the creation flow

| Caller | Flow | Result |
| --- | --- | --- |
| New Project onboarding | `POST /api/projects` | Creates a Project and its first environment together, with independently supplied names. |
| Existing workspace creation UI or caller | `POST /api/workspaces` | Creates a workspace and, when Project writers are enabled, automatically creates its Project, preserving the existing workspace response. |
| Create another environment by forking | Existing workspace fork operation | Inherits the source workspace's Project; unassigned legacy families remain unassigned until backfilled. |

Both POST endpoints are internal, session-authenticated APIs. `POST /api/projects` is not a public `/api/v2` endpoint and does not accept API-key principals. This foundation does not remove or deprecate existing workspace creation endpoints.

Do not call both creation endpoints for one onboarding flow: each creates a new workspace and a new Project. Neither endpoint attaches a workspace to an existing Project. A general Project environment-creation endpoint is follow-up work.

## Create a Project and its first environment

Use the shared client and contract for same-origin application calls:

```ts
import { requestJson } from '@/lib/api/client/request'
import { createProjectContract } from '@/lib/api/contracts/projects'

const result = await requestJson(createProjectContract, {
  body: {
    organizationId: selectedOrganizationId,
    name: 'Customer support',
    initialEnvironment: { name: 'Production' },
  },
})
```

All three inputs are required:

- `organizationId`: the intended organization's ID, or explicitly `null` for a personal Project. There is no fallback to the session's active organization. The caller must be eligible to create in the requested scope; an ineligible organization request is not silently converted to personal creation.
- `name`: the Project name, trimmed and limited to 1–100 characters.
- `initialEnvironment.name`: the first environment's name, also trimmed and limited to 1–100 characters. There is **no default environment name**; `Production` above is an example supplied by the caller.

For personal creation, use the same request with `organizationId: null`.

The HTTP 201 response contains both IDs and names:

```json
{
  "project": { "id": "<project-id>", "name": "Customer support" },
  "initialEnvironment": { "id": "<workspace-id>", "name": "Production" }
}
```

`initialEnvironment.id` is the workspace ID for existing workspace routes and navigation.

The application operation creates the Project, workspace, Project membership, initial administrator permissions, and starter workflow in one database transaction. A failed transaction leaves none of these new records committed. This endpoint always includes the starter workflow; it has no `skipDefaultWorkflow` option.

Creation uses existing workspace eligibility, billing, and `workspace.create` permission-group rules. Choosing personal scope does not bypass applicable organization permission-group restrictions. This endpoint has no idempotency-key support: resubmitting after an uncertain network result can create another Project, so do not blindly retry.

## Existing workspace creation

Existing callers can continue to use `createWorkspaceContract` and `POST /api/workspaces` with their current body:

```json
{
  "name": "Support workspace",
  "skipDefaultWorkflow": false
}
```

`skipDefaultWorkflow` remains optional and defaults to `false`. The route uses the session's active organization and existing workspace creation policy to resolve ownership and billing. It does not take the explicit Project scope or independent Project name used by `POST /api/projects`.

When Project writers are enabled, the workspace and its Project are created atomically. The generated Project name is `Support workspace - Project`; long names are bounded to 100 characters while retaining the suffix. The response remains `{ "workspace": ... }` with HTTP 200, without a new Project response wrapper. Call `GET /api/projects/by-workspace/[workspaceId]` when an existing workspace caller needs its authorized Project details.

## Server implementation

The Project route calls `createProject` in `application/create-project.ts`. Existing workspace callers continue through their current creation paths. Both use the shared transaction primitive in `lib/workspaces/create.ts`; surface adapters must not independently commit Project and workspace creation.

Project descriptions and Project-scoped files are not part of this creation contract. Project-scoped files and a designated Project brief are follow-up work.
