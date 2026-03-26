# Hooks Scope

These rules apply to custom hooks under `apps/sim/**/hooks/**` and `apps/sim/**/use-*.ts`.

- Give each hook a single clear responsibility.
- Define a props interface for hook inputs.
- Use refs for stable callback dependencies when avoiding dependency churn.
- Wrap returned operations in `useCallback` when the consumer benefits from stable function identity.
- Track loading and error states for async hooks when relevant.
- Use `try`/`catch` around async operations that can fail.
- Keep hook logic separate from rendering concerns.
