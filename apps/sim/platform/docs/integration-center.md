# Integration center

`/integrations` at the organization root is the member-facing management surface for Apps, Skills, MCPs and Credentials. Home and eligible organization workspace entry points navigate here rather than mounting another copy. A standalone workspace, or a viewer without the organization's Search access, retains the existing workspace credential route until an authorized replacement exists. Organization approval and source administration remain in Settings. Entering from a workspace must not silently turn a personal credential into an organization or workspace credential.

## Product structure

| Destination | Content |
| --- | --- |
| Apps | Connected apps first, then available apps filterable by category. Provider names and descriptions come from existing catalog metadata. Member credentials retain their provider detail routes. |
| Skills | Shared and Personal sections. A skill has a name, description and instructions, with ownership shown separately from its content. |
| MCPs | Shared and Personal sections for custom servers. Connection details belong to the server, not a fabricated provider catalog. |
| Credentials | Shared and Personal sections for named credentials and secrets. Show access in the list and ownership in the detail or editor, without exposing a secret in a list. |

Keep the heading, description, reading column and major gaps aligned with Home. DestinationTabs and the compact control bar follow the Platform Workspaces anatomy in Paper. Search sits at the start of the control bar; destination-specific sorting, filtering and create actions sit at the end. Category and access choices use ChoiceMenu, the exact Home period owner with a compact quiet trigger. Select/SelectField belong to the editor's form fields, not this toolbar. Categories and ownership sections live in the content, not as another nested tab system.

The route entry stays thin. `integrations/_components/integration-center/` owns the frame and destination composition. `resource-list/` and `resource-editor/` own the feature's list content and editor fields. Reuse EMCN DestinationTabs, SearchField, ActivityRow, Avatar, Button, Menu, Modal and Field owners. Base UI supplies complex behavior inside EMCN; product code supplies data and callbacks. Leading marks align with the first line, trailing people and actions center against the whole row, and lists use the same shared rhythm as Home email and notification rows.

## Data and access

Apps retain the existing [member inventory and credential contract](organization-integrations.md). A connected account or an organization-approved provider does not prove that its credential is shared. Usage avatars and counts require an authorized roster projection; do not derive organization usage from the viewer's personal accounts or expose another member's credential label.

New skill, MCP, sharing and credential editor interactions are UI work. Their example records are loaded only through the server fixture flag and edited in the product session. Skills and MCPs are shown only in fixture mode until their live data adapters exist. Live Apps and Credentials render only data and actions supplied by an existing authorized operation. They must not substitute fixture records when a request is loading, denied, unavailable or failed. Sharing controls in an example are not permission enforcement, and creating a local example must not call a real credential, secret or policy mutation.

The organization center is the canonical destination. Workspace navigation resolves the workspace host and the viewer's organization eligibility before linking or redirecting there; it never uses the session's unrelated active organization or silently changes credential scope. Preserve the existing route for viewers who cannot use the organization center, rather than trapping them behind an unavailable page. Paper references and historical documentation do not justify another Platform workspace management surface. The browser and Electron use the same renderer.

## Verification

Check destination navigation and browser history, search and empty results, sort/filter controls, create/edit/cancel flows, personal/shared grouping, dropdown placement and keyboard dismissal. Verify long names, multiple usage avatars, empty and stress data, narrow and intermediate widths, dark theme and real overflow fades. Fixture-off output must contain no sample people, credentials or shared resources. Existing live Apps detail and connection behavior must remain reachable.

Run the Platform design audit, type check, build and browser checks from the [README](../README.md). The static audit enforces styling and ownership boundaries and unused variants. Review independently that every new shared visual variant has two real consumers and that custom feature anatomy uses an established layout rhythm; a numeric JSX count cannot establish those design decisions.
