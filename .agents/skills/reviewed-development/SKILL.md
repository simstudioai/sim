---
name: reviewed-development
description: Plan or implement substantial engineering work with repeated independent reviews by fresh agents. Use when the user requests evidence-based planning or careful end-to-end implementation with unbiased multi-model review before delivery.
argument-hint: "<plan|implement> [task, plan path, or delivery instructions]"
disable-model-invocation: true
---

# Reviewed Development

Run a substantial planning or implementation task with repository-grounded,
independent review.

## Select the mode

Infer the mode from the user's request or the first argument:

- **Plan**: design and refine an implementation plan without changing product
  code. Read `.agents/skills/reviewed-development/PLANNING.md`.
- **Implement**: execute an approved plan or concrete task, verify it, and
  prepare the authorized delivery. Read
  `.agents/skills/reviewed-development/IMPLEMENTATION.md`.

If the request genuinely does not reveal whether the user wants a plan or code,
ask before proceeding. Never let planning silently become implementation.

For either mode, first read
`.agents/skills/reviewed-development/INDEPENDENT_REVIEW.md`. It defines how the
working model must dynamically generate neutral prompts for fresh reviewers. It
is a protocol, not a fixed reviewer prompt.

The parent model remains responsible for exploration, decisions, triage,
verification, and the final result. Reviewers advise; they do not replace the
working model's judgment.
