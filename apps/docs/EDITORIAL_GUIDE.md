# Documentation editorial guide

Use this guide with [Sim's product language](../../.claude/rules/constitution.md). Documentation explains how the current product works. Each page should help a reader complete a task, understand a decision, or look up a contract.

## Voice and terminology

- Lead with one or two sentences explaining the task or behavior. Use active voice, short sentences, concrete examples, and imperative steps.
- Remove promotional adjectives, repeated introductions, generic benefits, and unsupported guarantees. Prefer “Deploy the workflow” to “Unlock the power of automation.”
- Name the actor when access matters: member, workspace Admin, organization owner, personal API-key caller, or workspace API key. A workspace role, OAuth scope, resource grant, and permission-group restriction are different controls.
- Use **Sim** for the conversational agent, **Chat** for its surface, and **workflow builder** for the visual editor. Workflow terminology is appropriate when documenting the Workflows module. Preserve literal command names, protocol identifiers, environment keys, and compatibility fields.
- Use sentence case for titles, descriptions, headings, navigation labels, and API summaries. Preserve product names and acronyms such as API, MCP, OAuth, and SSO. Define unfamiliar terms on introductory pages.
- Match visible UI labels exactly and format them in **bold**. Format commands, paths, fields, statuses, and literal values as `code`. Keep code examples copyable.
- Use KiB, MiB, and GiB for limits defined in powers of 1024. Identify whether a number is a default, a hard limit, a configurable setting, or an illustrative example.

## Page organization

Use the order appropriate to the page. These are ordering rules, not a requirement to add empty sections.

| Page type | Order |
| --- | --- |
| Overview | Purpose → when to use it and supported capabilities → shortest path to use → important boundaries → related docs |
| Task guide | Result → actual prerequisites → numbered steps with examples at the relevant step → verify the result → limits or troubleshooting → related docs |
| Concept | Purpose or decision → behavior and example → boundaries and edge cases → related docs |
| Block reference | Purpose → minimum working example → settings and inputs → outputs → behavior, limits, and errors → distinct additional examples → related docs |
| Integration reference | Purpose → connection requirements and setup → use guidance → actions with inputs and outputs → triggers with configuration and outputs → shared schemas and operational notes → related docs |
| Operator guide | Deployment scope → prerequisites → supported setup → verification → operational and security consequences → troubleshooting or reference → related docs |
| Command or API reference | Purpose and access → invocation or request example → inputs and defaults → outputs and statuses → consequences, errors, and limits → related references |

Group large references by resource and lifecycle. Keep comprehensive machine references when they serve a separate lookup purpose. Keep prerequisites before the action they govern and destructive consequences before the command or control that triggers them.

Prefer concrete headings such as “Create a connection,” “Outputs,” or “Handle failed requests” over “Overview,” “Advanced features,” and “Best practices.” End onward navigation under **Related docs**, after substantive content.

## Preserve useful information

Shorten by removing repetition and organizing facts. There is no universal word limit.

Keep exact syntax, required fields, permissions, defaults, unsupported cases, resource limits, billing behavior, security boundaries, failure effects, and recovery procedures. Distinguish Cloud from self-hosted deployments and billing-enabled behavior from billing-disabled behavior. Distinguish drafts from deployed versions and an accepted operation from completed background work.

Verify claims against the current owning implementation and visible controls. Use current primary documentation for external services. A repository default does not prove the live hosted configuration. If sources disagree, qualify the statement and record the unresolved conflict in the audit rather than choosing an unsupported guarantee.

Give repeated detail one canonical owner:

| Detail | Canonical owner |
| --- | --- |
| Setup requirements and procedures | The relevant task or operator guide |
| Feature behavior, outputs, and limits | The feature or block reference |
| Roles, resource grants, and membership | Permissions and the specific resource guide |
| Permission-group resolution | Enterprise permission groups |
| Effective retention and cleanup | Enterprise data retention |
| Credits, metering, and billing distinctions | Costs |
| API authentication and envelopes | API getting started and authentication |
| Streaming frames and protocol | Workflow streaming guide |
| CLI options and command consequences | Generated command reference |

A link replaces repeated detail only after the owner contains it. Keep a concise prerequisite or consequence at the point where the reader needs it.

## Components and media

- Fold useful FAQ answers into the section they explain. Keep a separate FAQ only for questions that cannot be organized coherently elsewhere.
- Use a callout for a specific prerequisite or a non-obvious security, data-loss, or operational risk that deserves interruption. Use ordinary prose or a table for normal explanation. Keep important limits visible.
- Use Markdown lists and tables for simple procedures and reference data. Use tabs for distinct configurations and Steps for substantial sequential procedures.
- Integration table cells use ordinary word wrapping so short field names and types stay readable. Keep long tokens within the existing table scroll container; do not let them widen the page.
- On large integration references, keep action and trigger descriptions visible and fold their field tables into `ReferenceDetails`. Preserve headings inside each disclosure so direct links and browser search can reveal them. Setup requirements and consequential warnings stay outside the folded tables.
- Integration logos belong beside the page title, using the generated `integration` frontmatter. Keep the regular docs header actions and do not repeat the logo in the article body.
- Match inline code to Sim Chat: normal-weight monospace text, tight padding, and the existing borderless filled surface tokens. Scope the treatment to prose code; preserve fenced examples, API route bars, schema controls, and selector labels.
- Use shared `ChipSelect` controls for API response and request-example pickers, with accessible names that include the current value, checked radio semantics for single choices, and menus aligned to their triggers. Keep docs pickers nonmodal so they do not hide lazily hydrating siblings. Keep response headings free of inherited extra margins. Scope dependency filter styling to `data-object-search-input`, including schema popovers portaled to the body; focus stays inside the field, and touch fields retain the shared target and text sizes.
- Import authored tabs from `@/components/ui/tabs`. Mixed panels retain a content inset; only a single code fence fills the frame. Keep long tab lists horizontally scrollable and long prose references wrapped. For bookmarked panels, use explicit native `TabsList`/`TabsTrigger` controls with `aria-controls` matching each panel ID; changing a panel ID alone leaves the generated control pointing at a nonexistent element.
- Keep a screenshot when it locates a difficult control or shows a meaningful result. Keep a video when motion explains behavior that text or a static example cannot. Remove decorative, redundant, misleading, or non-rendering media.
- Capture the current product with a small, neutral example. Use the shared `Image` component: `overview` for a workspace or full settings panel, `detail` for a complete dialog or focused control, and `result` for an output. Keep the branded background in both the page and media viewer. Overview and result images extend to the frame's bottom edge, with scenery above and beside the window. Crop empty canvas at the source; never cut off a control or result needed by the instructions. Keep complete dialogs inset so their actions remain visible.
- Use a full-width window when the surrounding UI explains where to act. Use a closer crop when the reader needs to identify a specific control. Preserve the actual window chrome, borders, and product colors; do not fabricate UI or add imitation operating-system controls. Check each composition at its rendered article width and in the media viewer.
- For resource overviews, keep Chat visible with the workflow, table, or file open beside the conversation. Show a real request and result using neutral example data. Reserve standalone views for instructions that require their controls, and retain focused crops for dialogs or field details. Selecting a resource through the composer's `@` picker or **+** menu adds context and opens its panel; verify this behavior when documenting a new resource type.
- Keep one useful capture per task or result. Prefer concise steps over a screenshot for every click. Use the supplied grayscale landscapes and architecture, preserve the product's actual colors, and add a caption only when it explains something the image or adjacent text does not.
- Inspect media before describing it as stale. Uninspected remote media is unverified; it may still be removed when the written procedure fully covers its purpose. Do not fabricate replacement captures.
- Remove imports, components, preview definitions, local styling, and assets made unused by an edit after checking all consumers, including integration pages.

## Links and generated sources

Preserve page paths and stable operation IDs. Before renaming a heading, check inbound links from all docs and application code. Preserve a referenced anchor with a custom heading ID such as `## New heading [#existing-anchor]`. Check links from integration pages even when their copy is outside the editing scope.

Edit generated prose at its owner, then regenerate:

| Output | Owner | Command from the repository root |
| --- | --- | --- |
| OpenAPI documents and operation pages | `apps/sim/lib/api/contracts/v2/**`, OpenAPI metadata, and `scripts/openapi/generator.ts` | `bun run generate:openapi` |
| CLI API inputs | Generated OpenAPI and CLI contract overrides | `bun run generate:cli-api` |
| CLI reference pages and navigation | Command tree, CLI metadata, and `scripts/generate-cli-docs.ts` | `bun run generate:cli-docs` |
| MCP operation catalog | Authorized operation definitions and generated OpenAPI | `bun run generate:mcp-operations` |
| v2 route table | Canonical route definitions | `bun run generate:v2-route-table` |
| Marked Agent streaming table | Streaming protocol metadata and `scripts/sync-agent-stream-docs.ts` | `bun run generate:agent-stream-docs` |
| Integration references, icons, navigation inventory and public catalog | Block/tool/trigger and OAuth metadata; authored `MANUAL-CONTENT` regions; registered credential guides; `scripts/generate-docs.ts` | `bun run scripts/generate-docs.ts` |

Do not hand-edit generated pages, JSON specifications, or marked generated regions. Preserve all argument, option, schema, authentication, and confirmation detail. CLI descriptions also feed command discovery; run the existing search-ranking checks after changing help copy. Validate rendered request examples against their canonical input contracts; schema validity alone may still leave a semantic error such as an invalid serialized workflow.

The integration generator refreshes tool metadata before reading it. Its `--check` mode verifies that dependency without writing files and stops if it is stale.

Integration `MANUAL-CONTENT` regions are intentionally authored source: the generator reads and preserves them from the existing MDX. Edit generated descriptions in their block, tool, trigger, or OAuth owner. Edit fully authored credential guides registered in `content/integration-navigation.json` directly. Preserve action names, field names, scopes, conditional requirements and nested output paths. Token validation may verify identity without proving resource access, every permission, or future token validity; state what the actual validator checks. Preserve old heading anchors when standardizing shared generated headings. After regeneration, run it again and confirm no further changes; verify registered guides and all authored regions survive.

## Review checklist

Read the complete page and its examples. Check every useful fact against the original before cutting or moving it. Confirm the opening, order, terminology, headings, and component choices follow this guide. Compile MDX, check internal links and anchors, regenerate affected references, and inspect representative rendered pages on desktop and a narrow viewport. Run the repository's required validation gates for source changes.
