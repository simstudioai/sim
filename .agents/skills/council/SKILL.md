---
name: council
description: Spawn parallel task agents to explore a given area of the codebase from multiple angles, then use their findings to answer the question or build a plan. Use when a task needs broad fan-out exploration across many files before acting.
# No agents/openai.yaml by design: council is a meta/exploration utility (like cleanup, ship, you-might-not-need-*), not a service-integration builder, so it intentionally ships no standalone agent card.
---

Based on the given area of interest, please:

1. Dig around the codebase in terms of that given area of interest, gather general information such as keywords and architecture overview.
2. Spawn off n=10 (unless specified otherwise) task agents to dig deeper into the codebase in terms of that given area of interest, some of them should be out of the box for variance.
3. Once the task agents are done, use the information to do what the user wants.

If user is in plan mode, use the information to create the plan.
