---
name: you-might-not-need-an-effect
description: Analyze and fix useEffect anti-patterns in your code
argument-hint: "[scope] [fix=true|false]"
---

# You Might Not Need an Effect

Arguments:
- scope: what to analyze (default: your current changes). Examples: "diff to main", "PR #123", "src/components/", "whole codebase"
- fix: whether to apply fixes (default: true). Set to false to only propose changes.

User arguments: $ARGUMENTS

Steps:
1. Read https://react.dev/learn/you-might-not-need-an-effect to understand the guidelines
2. Analyze the specified scope for useEffect anti-patterns
3. If fix=true, apply the fixes. If fix=false, propose the fixes without applying.

## Query-backed forms

When query data supplies the initial values for an editable form, do not copy it into draft state in an Effect. Render loading chrome in an outer component, then mount a keyed form child once data exists and initialize its state lazily from props. Key by the resource identity so every related draft, dialog, and upload state resets together when the resource changes. Keep independent queries in the outer component to preserve parallel fetching.
