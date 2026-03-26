# Triggers Scope

These rules apply to trigger definitions under `apps/sim/triggers/**`.

- Research the service webhook model before implementing triggers.
- Keep each service under `triggers/{service}/` with barrel exports and event-specific files.
- Use shared helpers for setup instructions, extra fields, and output definitions when multiple triggers in the same service need them.
- Ensure the primary trigger supports switching between trigger types when the integration pattern requires it.
- Keep trigger outputs explicit and useful for downstream blocks.
- Register triggers in `triggers/registry.ts` and keep IDs aligned with the integration naming scheme.
