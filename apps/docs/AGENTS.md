# Documentation guidelines

Read [EDITORIAL_GUIDE.md](EDITORIAL_GUIDE.md) before editing documentation. It defines the voice, terminology, page types, section order, and component choices. [COPY_AUDIT.md](COPY_AUDIT.md) records the general documentation audit; [INTEGRATIONS_AUDIT.md](INTEGRATIONS_AUDIT.md) records the integration audit and provider compatibility qualifications. Keep new conclusions evidence-based.

## Copy and accuracy

- Read the complete original page before rewriting. Preserve useful prerequisites, syntax, examples, permissions, defaults, limits, failure consequences, and recovery instructions. Move repeated detail only after its canonical owner contains it and the local link works.
- Verify consequential behavior against its current implementation. Use primary documentation for external procedures. Distinguish repository defaults from deployed settings, Cloud from self-hosting, and accepted operations from completed work.
- Keep Chat content delivery separate from ordinary UI, API-key, MCP, and workflow access. A saved write can have a withheld result; do not imply that a display failure undoes the write.
- Use concise, concrete prose and sentence-case headings. Remove repetition and decorative components without making required information sparse. Honor the editing scope; shared components and assets may still serve excluded pages.

## Sources and generation

- Edit generated API and CLI prose at its owner, then use the generation commands in the editorial guide. Do not hand-edit generated specifications, reference pages, or marked generated regions.
- Preserve page URLs, operation IDs, method/path pairs, command options, authentication, and schema behavior. Validate copyable request bodies against the canonical input contracts.
- Check inbound heading anchors from the entire docs site and application before renaming them. Use native explicit tab triggers for provider bookmarks, with `aria-controls` matching panel IDs; preserve the reciprocal `aria-labelledby` relationship and avoid duplicate element IDs.
- Search citations must use the page's explicit heading IDs and omit the alias syntax from result titles.

## Layout and components

- Use existing Sim tokens and EMCN chrome. Keep styling local to the component; do not add global CSS overrides or custom colors for one page.
- Use [the authored tab components](components/ui/tabs.tsx). Mixed prose/code panels retain padding; a single code fence can fill its frame. Preserve native selection, keyboard behavior, and intentional code/table scrolling.
- Page spacing belongs to the page container. The navbar, TOC, and sidebar must agree on breakpoints and reserved row heights. Use the shared section order and route matching in `lib/navigation.ts`.
- Inspect mobile, tablet, desktop, and breakpoint boundaries. Check 320px and 390px widths, both sides of 640px, 768px, 1024px, and 1280px, plus a wide desktop. Verify headings clear sticky chrome, drawers remain reachable, touch targets are usable, and prose does not overflow. Restore temporary viewport and theme changes after QA.

## Verification

Compile the affected MDX, check internal links and preserved anchors, run the required repository gates, and inspect the production build. Validate all affected tabs and navigation states, rather than only their default panels. Record exact scope and limitations; a successful build does not prove an external provider setup or live Cloud configuration.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
