# Sim documentation

The documentation site uses Next.js and Fumadocs. Read the [editorial guide](EDITORIAL_GUIDE.md) before changing copy or page organization. The [copy audit](COPY_AUDIT.md) records the complete page inventory, accuracy corrections, and validation.

## Develop

From this directory:

```bash
bun run dev
```

Open `http://localhost:3001`. Build the site with `bun run build` and run the built server with `bun run start`.

## Content owners

- Authored pages and navigation: `content/docs/**` and each section's `meta.json`.
- API operation pages: generated `openapi*.json`, owned by `apps/sim/lib/api/contracts/v2/**` and `scripts/openapi/generator.ts`.
- CLI reference pages: generated from the command tree by `scripts/generate-cli-docs.ts`.
- Interactive workflow examples: `components/workflow-preview/**`.
- Local media: `public/static/**`. Product captures use the shared `Image` component and branded backgrounds.

Use the owner and generation commands listed in the editorial guide. Do not hand-edit generated reference pages. The build also generates `llms-full.txt` from the current content.

## Validate

From the repository root, run the required lint, type, audit, and test gates in the development guidelines. From this directory, `bun run type-check` compiles MDX and checks the docs workspace, and `bun run build` validates the production site. Inspect affected page types on desktop and a narrow viewport, and check internal links and existing anchors after heading changes.

The docs HTTP workflow also checks sidebar navigation, API language switching, and copying Markdown on desktop and mobile layouts. It uploads screenshots and a JSON report with the HTTP regression artifacts. These checks run against the built site in CI; no visitor telemetry is collected. Use Vercel's build logs and usage reports to compare deployment cost and duration.
