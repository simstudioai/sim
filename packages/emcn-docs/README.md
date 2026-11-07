# EMCN Docs

Documentation compositions use the modern `@sim/emcn` foundations and interface geometry. Import a family such as `@sim/emcn-docs/tabs` or `@sim/emcn-docs/code-block`. Private helpers use `#docs` package imports. Components and their CSS Modules live together by family.

The app imports `styles/docs.css` once. It imports the shared EMCN foundations and defines scoped Docs roles for reading typography, navigation, code, and translucent surfaces. Attach `data-emcn` to the document root and portaled surfaces; `docs-root` and `docs-portal` select the Docs roles in both themes. A new common color, spacing role, control behavior, fade, or motion policy belongs in `@sim/emcn`, not a Docs override. Component recipes own their chrome; product callers own content and layout.

Base UI owns menu, dialog, and tab keyboard behavior. Authored tabs keep inactive content mounted with `hidden="until-found"` so direct links and browser find reveal it; every tab and panel retain reciprocal explicit IDs. TabsSelect is a nonmodal radio menu. Shared scroll measurement applies fades only at overflowing edges. Copy feedback uses the shared four-second dwell and preserves transient user activation for asynchronously prepared Markdown.

Article routing, content compilation, search data, provider assets, and workflow examples stay in `apps/docs`. The existing workflow canvas is an explicit legacy content adapter; its legacy variables are scoped in its own CSS Module. Docs chrome and this package never import legacy EMCN.

Run `bun run type-check` here and `bun run type-check` in `apps/docs`. After building Docs, run `test:navigation:e2e` with `DOCS_E2E_BASE_URL` and `DOCS_NAVIGATION_REPORT_PATH`; it records keyboard, clipboard, media, responsive containment, runtime, and theme checks with screenshots. Follow the feedback TLS fixture setup in the Docs CI workflow for the complete navigation suite. Run `test:corpus:e2e` with `DOCS_CORPUS_REPORT_PATH` when content component imports change.
