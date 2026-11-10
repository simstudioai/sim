---
name: emcn-legacy-design-review
description: Review legacy Sim UI built on @sim/emcn-legacy against its component and styling rules. Platform UI in apps/sim/app/(product) and apps/sim/platform goes to implement-platform's review mode instead.
argument-hint: "[scope] [fix=true|false]"
---

# EMCN Legacy Design Review

Arguments:
- scope: what to review (default: your current changes). Examples: "diff to staging", "PR #123", "apps/sim/components/", "whole codebase"
- fix: whether to apply fixes (default: true). Set to false to only propose changes.

User arguments: $ARGUMENTS

Files under `apps/sim/app/(product)/**` or `apps/sim/platform/**` go to [implement-platform](../implement-platform/SKILL.md)'s review mode; review the rest here, keeping the requested `fix` mode for both.

## Steps

1. Read the contract: [`.claude/rules/emcn-legacy-components.md`](../../../.claude/rules/emcn-legacy-components.md) (components, chip chrome, modal keyboard defaults) and [`.claude/rules/sim-styling.md`](../../../.claude/rules/sim-styling.md) (tokens, text scale, icons, line weight). Settings pages add [`.claude/rules/sim-settings-pages.md`](../../../.claude/rules/sim-settings-pages.md), and copy follows [`.claude/rules/sim-ui-copy.md`](../../../.claude/rules/sim-ui-copy.md).
2. Read what the library offers: the barrel `packages/emcn-legacy/src/index.ts` and the icon set `packages/emcn-legacy/src/icons/index.ts`.
3. Check every file in scope against every rule in those documents. A finding names the file, the line, the rule it breaks and the replacement.
4. Check each changed surface at 320px and 390px with touch, then desktop: navigation, primary actions and dismissal stay reachable without hover.
5. If fix=true, apply the fixes. If fix=false, propose them without applying.
