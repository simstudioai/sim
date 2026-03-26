# Tools Scope

These rules apply to integration tool definitions under `apps/sim/tools/**`.

- Start from the service API docs before adding or changing a tool.
- Keep each service under `tools/{service}/` with `index.ts`, `types.ts`, and one file per action.
- Tool IDs must use `snake_case` and match registry keys exactly.
- Use `visibility: 'hidden'` only for system-injected params such as OAuth access tokens.
- Use `visibility: 'user-only'` for credentials and account-specific values the user must provide.
- Use `visibility: 'user-or-llm'` for ordinary operation parameters.
- In `transformResponse`, extract meaningful fields instead of dumping raw JSON.
- Use `?? null` for nullable response fields and `?? []` for optional arrays where appropriate.
- Register every tool in `tools/registry.ts` and keep entries aligned with the exported tool IDs.
