# Planning Mode

Create a plan that is grounded in the current repository, independently
challenged, and ready for another agent or engineer to implement. End with the
reviewed plan; do not implement product changes.

## 1. Establish the real objective

Derive or confirm:

- The user-visible or operational outcome.
- Scope, non-goals, constraints, and compatibility requirements.
- Definition of done, including executable proof and any manual acceptance.
- Delivery boundaries such as migrations, rollout order, CI, documentation,
  deployment configuration, or branch strategy.
- Decisions that genuinely belong to the user.

Do not mechanically accept assumptions in the request. Verify claims where the
repository can answer them, and ask only for choices that materially alter the
result.

## 2. Explore before designing

Inspect enough of the repository to understand:

- Current architecture and data flow.
- Canonical sources of truth and nearby implementations.
- Existing tests, fixtures, validation, observability, and deployment patterns.
- Historical compatibility surfaces that cannot be changed atomically.
- Work already present on the branch and unrelated changes that must remain
  untouched.

Use parallel exploration when areas are independent. The parent model remains
responsible for synthesis; do not delegate the entire planning task to one
subagent.

## 3. Draft an implementation-ready plan

Write the plan for the actual task rather than forcing a universal template.
Include the following when relevant:

- Goal and definition of done.
- Current behavior and evidence.
- Technical direction and why it fits existing patterns.
- Concrete files, modules, interfaces, and data flows to change.
- Sequenced implementation phases and dependencies.
- Authorization, security, privacy, secret, and trust boundaries.
- Schema, migration, compatibility, rollout, and rollback considerations.
- Test strategy at unit, integration, browser, CI, and manual levels.
- Diagnostics and cleanup behavior.
- Documentation and ownership updates.
- Explicit non-goals, assumptions, risks, and unresolved user decisions.

Prefer the smallest complete design. Avoid speculative frameworks, duplicated
sources of truth, compatibility layers without a consumer, and cleanup unrelated
to the objective.

## 4. Commission independent reviews

Generate self-contained prompts from the current repository and plan according
to the independent-review protocol. Launch two fresh reviewers concurrently
when possible. Do not assign one a desired conclusion or narrow each reviewer
to a concern chosen by the parent; both should be free to assess the whole plan, and should be asked for their genuine opinion, whether this is that everything is perfect, we 're almost there, or everything is terrible and the direction should be completely changed.

Ask reviewers to verify the proposed design against real code and identify
mistakes, missing requirements, pattern mismatches, unsafe assumptions,
overengineering, redundancy, weak proof, and anything else they genuinely
dislike.

## 5. Triage and refine

For each finding:

- Confirm the evidence yourself.
- Improve the plan when the concern is valid.
- Push back with concrete technical reasoning when it is not.
- Ask the user only when the finding exposes a real product or risk decision
  that the repository cannot resolve.
- Resume each reviewer separately with the revised plan and the response to its
  findings. Continue until it accepts the resolution or the protocol's
  unresolved-disagreement stop condition applies.

Preserve useful dissent in the working notes, but do not bias later reviewers
with earlier opinions or describe the plan as already corrected.

## 6. Re-review the current plan

After refinement, generate new neutral context from the current repository and
current plan. Begin another independent review cycle with an entirely new pair.
Never reuse reviewers from an earlier cycle.

If this review leads to substantive plan changes, material disagreement, or
unresolved uncertainty, repeat once with another fresh pair, subject to the
protocol's three-cycle cap. Each reviewer sees only the present task and
artifact, never the review sequence.

## 7. Finalize without implementing

Before presenting or saving the plan, ensure:

- Every core requirement maps to a concrete change and proof.
- File and architecture references match the current repository.
- Migration and rollout ordering is safe.
- Tests cover allowed, denied, failure, and cleanup behavior where applicable.
- No Critical, High, or Medium concern remains unresolved without an explicit,
  evidence-backed decision.
- The final substantive revision has been independently reviewed.

Save the plan only where the user or project convention requires. Report:

- The finalized plan location or plan itself.
- Important decisions and tradeoffs.
- Material reviewer-driven changes.
- Evidence-backed pushbacks.
- User-owned or manual steps that remain.

Stop there. Implementation requires a separate request using this skill's
implementation mode.
