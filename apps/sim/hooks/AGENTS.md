# Hooks Scope

These rules apply to custom hooks under `apps/sim/**/hooks/**` and `apps/sim/**/use-*.ts`.

See `.claude/rules/sim-hooks.md` for the full conventions (single responsibility, props interface, refs for stable deps, `useCallback` for returned operations, loading/error tracking, async `try`/`catch`, separating logic from rendering).
