# Blocks Scope

These rules apply to block definitions under `apps/sim/blocks/**`.

- Keep block `type` values and tool mappings aligned with the actual integration tool IDs.
- Every subblock `id` must be unique within the block, even across different conditions.
- Use `condition`, `required`, `dependsOn`, and `mode` deliberately to reflect the UX and execution requirements.
- Use `canonicalParamId` only to link alternative inputs for the same logical parameter; do not reuse it as a subblock `id`.
- If one field in a canonical group is required, all alternatives in that group must also be required.
- Put type coercion in `tools.config.params`, never in `tools.config.tool`.
- When supporting file inputs, follow the basic/advanced pattern and normalize with `normalizeFileInput`.
- Keep block outputs aligned with what the referenced tools actually return.
- `{Service}BlockMeta.skills` (curated, one-click-add agent skills shown on the integration detail page) must be grounded in operations the block exposes via `tools.access` and derived from real, popular use cases found online — web-search and source each one; never invent or hallucinate skills.
