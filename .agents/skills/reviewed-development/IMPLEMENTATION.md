# Implementation Mode

Implement the requested change completely, validate it in proportion to risk,
and subject the current result to repeated independent review before delivery.

## 1. Confirm the implementation contract

Read the accepted plan, current user request, relevant repository instructions,
and current branch state. Establish:

- Objective, scope, non-goals, and definition of done.
- Files and systems expected to change.
- Tests, rollout, documentation, and manual acceptance required.
- Whether commit, push, branch, or PR operations were explicitly authorized.
- Existing user changes that must be preserved.

If the plan has become stale, verify the current repository and adapt it
carefully. Escalate only decisions that materially change product behavior,
risk, or destructive outcomes.

## 2. Re-ground in current code

Inspect the implementation paths and nearest established patterns before
editing. Do not rely solely on summaries or the plan's file list. Check for
changes made since planning, hidden coupling, generated artifacts, migration
rules, and repository-specific validation commands.

Create a concise execution checklist for substantial work. Implement in
coherent phases, keeping only one phase actively changing the repository at a
time.

## 3. Implement the smallest complete solution

- Follow existing architecture, naming, contracts, and ownership boundaries.
- Address root causes instead of suppressing failures or adding broad
  workarounds.
- Keep security, authorization, data integrity, secret handling, and cleanup
  fail-closed.
- Preserve backward compatibility and safe rollout ordering where versions can
  overlap.
- Avoid unrelated cleanup, speculative abstraction, duplicate helpers, and
  infrastructure without a demonstrated need.
- Update tests and documentation alongside the behavior they protect.

Do not weaken invariants or tests merely to obtain a passing result.

## 4. Verify continuously

After each meaningful phase, run the cheapest relevant proof. Before review,
run the complete validation justified by the change, such as:

- Focused unit and integration tests.
- Type checking, linting, formatting, generated-file, and boundary checks.
- Migration, deployment, or compatibility verification.
- Browser or end-to-end tests through the project's supported orchestrator.
- Manual checks that cannot be automated.

Read failures as evidence. Fix introduced problems, distinguish unrelated
baseline failures explicitly, and do not report a check as passed unless it
actually ran successfully.

## 5. Self-review the current diff

Before commissioning reviewers:

- Compare the implementation with every plan requirement.
- Inspect the full diff, including generated and staged files.
- Check edge cases, negative paths, concurrency, partial failure, and cleanup.
- Confirm tests prove observable behavior rather than implementation details.
- Remove accidental duplication, debugging output, dead code, and unnecessary
  complexity.
- Verify no credentials, local artifacts, or unrelated user changes entered the
  diff.

## 6. Commission independent reviews

Generate two complete, neutral prompts from the current task, plan, repository,
implementation, diff, and verification evidence according to the
independent-review protocol. Launch two fresh reviewers concurrently when
possible.

Do not ask reviewers to validate the parent's preferred approach. Ask for their
genuine assessment of correctness, security, pattern fit, test quality,
maintainability, redundancy, overengineering, operational safety, and complete
coverage of the user's objective.

Reviewers must inspect the repository directly and remain read-only.

## 7. Triage, fix, and re-verify

Independently verify every finding:

- Fix valid issues with the smallest clean solution that matches repository
  patterns.
- Push back on false positives or harmful suggestions with concrete evidence.
- Resolve contradictions by examining code and requirements, not by choosing
  the more confident reviewer.
- Re-run all checks affected by substantive changes.
- Resume each reviewer separately with the current implementation and the
  response to its findings. Continue until it accepts the resolution or the
  protocol's unresolved-disagreement stop condition applies.

Do not tell the other reviewer or reviewers in later cycles what an earlier
agent found.

## 8. Re-review the current implementation

Generate fresh prompts describing only the current objective, code, diff, and
evidence. Begin another independent review cycle with an entirely new pair.
Never reuse reviewers from an earlier cycle.

If this review causes substantive edits, reviewers disagree materially, or
meaningful uncertainty remains, run one additional fresh pair after
re-verification, subject to the protocol's three-cycle cap. The final accepted
review must apply to the implementation being delivered.

## 9. Delivery gate

Do not declare completion until:

- The implementation satisfies the current plan and definition of done.
- Relevant automated checks pass, with manual-only checks identified.
- No Critical, High, or Medium concern remains unresolved without an explicit,
  evidence-backed decision.
- The final substantive revision has been independently reviewed.
- The diff is scoped, clean, and free of secrets or temporary artifacts.

Commit, push, or create a PR only if the user's request authorized those
mutations. Follow repository-specific git and PR procedures rather than
inventing a generic release flow.

Report concisely:

- What changed and why.
- Verification performed and outcomes.
- Material issues found and corrected.
- Evidence-backed pushbacks.
- Remaining manual actions or known limitations.
- Commit, branch, or PR details when delivery was authorized.
