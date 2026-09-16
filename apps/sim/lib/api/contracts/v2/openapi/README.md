# API description conventions

Write enough context to choose and use an operation correctly. Concision means removing repetition and implementation history while preserving behavior that changes the caller's next action.

## Where descriptions belong

| Location | Content |
| --- | --- |
| Operation `summary` | A short action and resource name, using the existing title-case convention: `Create Workflow`, `Replace File Content`. |
| Operation `description` | The result, relevant scope, and important behavior: side effects, partial success, asynchronous completion, destructive changes, retry safety, or a distinction from a related operation. |
| Parameter or schema description | The field's meaning, units, omission/null behavior, dependencies, and interpretation. Let the schema declare types, required fields, enums, and bounds; explain them in prose only when needed for correct use. |
| Response description | What the result represents, including partial, truncated, pending, or redacted results. |
| Shared metadata | Authentication, pagination exceptions, retention, and other rules reused across operations. Reuse the existing constants and generated OAuth scope annotations. |
| Examples | Valid request and response shapes, especially for nested or format-sensitive inputs. Keep them in structured example fields. |

## Writing rules

- Start with an active verb and the resource: “Archive a workspace file.” Follow with the facts that change how a caller uses the operation.
- Aim for one to three sentences for ordinary operations. Simple operations need less; complex operations need more. The existing 80-word description check is a ceiling, not a target or a reason to remove critical behavior. It includes generated OAuth scope text.
- Use consistent terms: **Get** for a single resource, **List** for a collection, **Create** for a new resource, **Update** for partial changes, **Replace** for complete replacement, and **Archive** when data remains recoverable. Existing operation IDs and paths remain stable.
- Describe actual patch semantics. Do not claim JSON Merge Patch compliance or atomicity merely because an operation uses `PATCH` or saves a batch.
- Keep destructive scope, cleared fields, partial commits, duplicate-execution risks, and polling instructions explicit. Never promise retry safety or completeness without implementation evidence.
- Name related operations consistently. Shared schema descriptions also appear in CLI help, so use operation names rather than HTTP method/path instructions there.
- Use the same wording for the same behavior across resource families: “Omitted fields remain unchanged,” “Archive,” and “permanently delete.” Describe completion as “during the request” or “asynchronously” instead of “settled inline.” Keep distinctions where behavior differs.
- Remove implementation rationale, migration history, rhetorical warnings, and claims such as “far above any real inventory.” Keep practical limits and how to handle them.
- Describe user-visible outcomes instead of storage formats, locking, redaction internals, or deployment architecture. For an open-ended status, say to handle unknown values; the caller does not need to know how statuses are stored. Keep implementation details only when they change correct usage.
- Avoid generic filter inventories and repeated schema details. Preserve exceptions such as bounded pages, null cursors with truncated results, and counts read independently of result pages.

For example, an upsert description should say: “Insert a row or replace the row matching a selected unique column. On replacement, omitted columns are cleared; send the complete row. Use Update Row for a partial patch.”

## Sources and verification

OpenAPI distinguishes short summaries from detailed descriptions and recommends explaining information beyond the schema. Its [documentation guide](https://learn.openapis.org/specification/docs.html) and [single-source guidance](https://learn.openapis.org/best-practices.html) support this separation.

Agent guidance emphasizes clear purpose, inputs, outputs, and caveats. [OpenAI's function-calling guide](https://developers.openai.com/api/docs/guides/function-calling) recommends detail sufficient to use a tool correctly. [Anthropic's tool guide](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools) recommends several sentences and more for complex tools. Neither establishes a universal optimal word count. Evaluate tool selection and argument correctness on representative tasks before claiming an agent-performance improvement from shorter descriptions.

Edit operation metadata here and field descriptions in their source contracts. Regenerate with `bun run generate:openapi`, `bun run generate:cli-api`, and `bun run generate:cli-docs`; check with the matching `check:*` commands and `bun run check:api-validation`. Do not edit generated artifacts by hand.

The CLI currently consumes operation summaries and input descriptions. Full operation descriptions are published in OpenAPI but are not displayed in CLI help; do not assume those paragraphs reach every agent.
