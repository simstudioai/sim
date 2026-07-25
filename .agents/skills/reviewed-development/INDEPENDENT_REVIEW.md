# Independent Review Protocol

This protocol defines how the working model commissions independent reviews. It
is not a reviewer prompt template.

Every reviewer in this protocol is a separate subagent launched by the working
model, not a perspective role-played in the parent conversation. In Cursor, use
the `Subagent` tool. A fresh reviewer means a new subagent invocation and agent
ID; a follow-up within the same review cycle resumes that subagent's existing
conversation.

## Generate prompts from the current task

Generate each reviewer prompt after inspecting the current repository and
artifact. The prompt must be self-contained because a fresh reviewer has no
access to the parent conversation.

Include the context that materially affects the review:

- A concise overview of the relevant codebase and architecture.
- The user's actual objective, constraints, non-goals, and definition of done.
- The current plan, diff, branch, or exact files to inspect.
- Established local patterns and sources of truth the work should follow.
- Important data, security, migration, deployment, or compatibility boundaries.
- Verification already performed, with exact commands and outcomes when useful.
- The areas changed and the behavior they are intended to provide.

Generate the prompt for the task at hand. Do not copy a fixed generic prompt or
fill a mechanical template with shallow substitutions.

## Keep every review independent

- Begin each independent review cycle with two fresh reviewers, preferably from
  different model families with strong reasoning capability. Honor models
  requested by the user.
- During that cycle, resume each reviewer separately to resolve its findings.
  Never reuse either conversation in a later independent review cycle.
- Do not tell a reviewer whether it belongs to the first, second, final, or any
  other review pass.
- The initial prompt in a cycle must not include findings, verdicts, responses,
  or changes from earlier cycles.
- Do not tell reviewers what conclusion to reach or imply that defects must
  exist. Acceptance is a valid result.
- Use the same generated prompt for both reviewers by default. Differ only when
  a model requires different technical context or tooling instructions, while
  keeping both reviews broad and neutral.
- Ask reviewers to inspect repository evidence directly rather than trusting the
  implementation summary.
- Keep reviewers read-only unless the user explicitly requested a separate
  implementation attempt.

## Ask for a genuine broad review

Ask each reviewer to judge the artifact as a whole and report anything it
genuinely dislikes. The review should consider, where relevant:

- Correctness, requirement coverage, and edge cases.
- Security, privacy, data integrity, authorization, and secret handling.
- Concurrency, failure recovery, cleanup, and partial-success behavior.
- Compatibility with existing architecture, conventions, and nearby patterns.
- Missing, brittle, redundant, or misleading tests.
- Unnecessary complexity, duplicated logic, speculative abstraction, and
  overengineering.
- Performance, operational, migration, rollout, and CI consequences.
- Documentation and manual steps required for safe ownership after merge.

This is a review surface, not a quota. Explicitly tell reviewers that acceptance,
many findings, or anything between are valid outcomes. They must not optimize
for finding count or manufacture criticism.

## Severity and response format

Require an explicit verdict and order concrete findings by severity:

- **Critical**: credible security compromise, data loss, destructive rollout,
  or another issue that makes proceeding unsafe.
- **High**: likely correctness failure, unmet core requirement, serious
  architectural mismatch, or major operational risk.
- **Medium**: material robustness, maintainability, test, performance, or
  pattern-consistency issue that should be resolved.
- **Small**: non-blocking polish or a narrowly scoped improvement.

Each finding must include:

- Concrete repository evidence, preferably a file and line or exact behavior.
- Why it matters and when it can fail.
- The smallest appropriate correction or decision needed.

If no substantive defect exists, the reviewer should say that plainly rather
than manufacture criticism.

## Triage without deference

The working model owns the result. For every finding:

1. Verify it against the repository and the user's objective.
2. Fix it when it is correct and within scope.
3. Push back when it is incorrect, conflicts with requirements, or would add
   unjustified complexity; retain the evidence for the final summary.
4. Re-run affected verification after substantive changes.
5. Resume that reviewer with the current artifact and an evidence-based account
   of what changed or why the finding was rejected.

Handle each reviewer independently; do not use one reviewer's opinion to steer
the other. Continue the exchange until the reviewer accepts the resolution or
has no substantive concern. Ask it to re-inspect the current artifact rather
than merely approve the parent's explanation.

Agreement does not mean obeying the reviewer. A valid endpoint may be a fix or
an evidence-backed pushback that the reviewer accepts. Follow-ups within a
review cycle are not capped: continue the separate exchange with each reviewer
until the concern is resolved. The three-cycle cap limits newly created reviewer
pairs, not follow-up messages in an active cycle.

Do not forward this cycle's triage history to reviewers in later cycles. Their
initial prompts describe only the current artifact and current evidence.

## Review completion

Run two independent review cycles by default. Each cycle begins with exactly two
newly created reviewers, and each reviewer reaches resolution through the
follow-up process above. Track cycle count only in the working session; never
expose it in reviewer prompts.

Run one additional cycle only when the later cycle causes substantive changes,
reviewers disagree on a material issue, or meaningful uncertainty remains.
Never exceed three cycles or six fresh reviewers for one planning or
implementation task.

After the third cycle, stop even if a reviewer still disagrees. Report the
unresolved concern, evidence, attempted resolution, and available decision to
the user rather than launching more reviewers. The final reviewed artifact must
be the artifact being presented or shipped, not an earlier revision.
