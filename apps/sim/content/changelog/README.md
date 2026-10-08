# Publishing a Sim product update

Create `content/changelog/<slug>/index.mdx`. The slugs `archive` and `preview` are reserved. The website, archive, individual pages, sitemap, and RSS all read published entries from this directory through the shared content registry.

The index shows up to 12 updates in chronological rows. When more exist, an Older updates link opens the archive at the first omitted entry. The archive links to every published update. Both lists read metadata only; the full article and its recordings are loaded on the individual update page. Rows use the local `ogImage` and `ogAlt`, so a reviewed demo poster also becomes the update's cover and share image. The page frame, typography, media radius, and row spacing use Sim's shared landing styles.

Write for a team using Sim: what changed, what they can do with it, and where to find it. Group related PRs into one product update. Keep maintenance, refactors, and routine content edits in the technical GitHub release history.

## What earns an entry

A public update needs one clear benefit, verified availability, a useful next step, and at least one reviewed feature image or video in the article. The cover alone is not enough. A reader should understand what they can now do and see evidence of that capability. A smaller improvement can join a related edition; it does not need its own announcement because a technical version shipped.

Review candidates weekly and publish when a story meets that bar. Skip an edition if there is nothing meaningful to announce. Use a separate entry for a substantial launch. Aim for one lead story and a short selection of related improvements or fixes, rather than reproducing every commit. The GitHub release link carries the complete technical history.

Always make consequential breaking changes, migrations, deprecations, and changes requiring action easy to find, including the affected version, availability, and next step. For a change with no useful product screen, a clearly labeled, accurate explanatory diagram can serve as the image. Do not delay an urgent notice to produce a polished video.

The initial deployment-comparison, fork-comparison, and Power BI stories use current captures from the running app with sample data. Their production records identify the source changes, capture environment, and demonstration limits. The separate reliability candidate remains a draft until it has feature-specific evidence and media. Do not remove `draft: true` just to populate the page.

## Production workflow

Each new update has one folder containing its public `index.mdx` and a non-rendered `production.md` brief. The registry only reads `index.mdx`; the brief and announcement drafts are not website content. Start from the [deployment comparison brief](./compare-workflow-deployments/production.md). Assign one release editor and one feature owner in the PR; both must complete their review before publication.

| Step | Owner | Output |
| --- | --- | --- |
| Gather evidence | Feature owner | Merged PRs, release version, deployment and permission availability, and a working example |
| Choose the story | Editor | One headline, the situation it helps with, and related improvements worth including |
| Prepare drafts | Editor, assisted by Codex | `index.mdx` with `draft: true`, demo shot list, and social/email copy in `production.md` |
| Produce media | Feature owner | Real product recording, poster, and captions for speech |
| Review | Feature owner and editor | Confirm the actual feature, rollout, and media; verify links and approve consistent copy |
| Deploy | Site maintainer | Merge the reviewed entry with `draft: false`; website, detail page, archive, sitemap, and RSS update together |
| Distribute | Editor | Send the reviewed announcement after the public URL and demo work |

Codex can read PRs and diffs, group related changes, and produce copy and shot lists from that evidence. Keep commit subjects as research inputs. The editor checks the benefit, feature availability, restrictions, and the demonstration. A GitHub release and a Cloud deployment are separate events. Do not draft a launch from an unverified release title alone.

For a new edition, `release.versions` can list several technical versions. When there is no single corresponding GitHub release, omit `release.url`; the editorial entry then has its own RSS identity.

Open `/changelog/preview` while running `next dev` to review drafts with the same list, typography, and article components as the public site. `/changelog/preview/<slug>` shows one draft. These routes return 404 outside development, emit `noindex`, and are excluded from the sitemap and RSS. Public routes continue to exclude drafts even during development. The preview rereads metadata after edits, so there is no need to temporarily publish a draft.

## Contextual links

Give readers the next useful step in the sentence that introduces a capability. Link an integration's name to its actual `/integrations/<slug>` page and link its setup instructions to the corresponding `docs.sim.ai` guide. Catalog slugs can differ from tool IDs: You.com is `/integrations/you-com`, while its guide is `/integrations/youcom` on the docs domain.

Use the guide for the exact surface being announced. Live Search connectors have their own `/search/<source>` guides; an ordinary workflow integration page can describe a different connection and permission model. Feature announcements should link to the feature guide, and API changes should link to the current generated operation page. Related Sim product pages and explanatory blog posts are useful when they help a reader use or understand the update.

Choose a few relevant links instead of repeating every destination in a separate resource list. Keep link text descriptive. The content audit checks integration destinations against the generated catalog and docs destinations against the MDX source and generated OpenAPI pages. Use current canonical URLs, including the operation ID's exact case. Confirm the linked page's instructions and any deep anchor in the deployment preview; a source file alone does not establish rollout or anchor correctness.

## Search and answer-engine visibility

Keep each summary independently useful: name Sim and the feature, explain the new capability, and state material availability limits in the article. Put setup steps and demonstration explanations in server-rendered text alongside the media. Do not leave important facts only inside a screenshot or video.

The index and archive use real links, semantic lists, and CollectionPage/ItemList data matching the visible entries. Articles keep their own canonical URLs, BlogPosting data, author bylines, original publication dates, and substantive correction dates. Public articles appear in the sitemap and RSS; previews stay noindex and drafts stay out of public routes. Preserve these properties when changing the layout. If the archive eventually needs pagination, use server-rendered pages with real next/previous links and a self-canonical URL for each page; do not make older entries accessible only through a JavaScript button.

These are standard search foundations, not a guarantee of indexing or AI citations. [Google's AI search guidance](https://developers.google.com/search/docs/appearance/ai-features) calls for crawlable, useful text, relevant media, internal links, and structured data matching the visible content; it does not require special AI-only markup. Avoid hidden keyword blocks, invented FAQs, and schema for information that the page does not show.

After deployment, verify a representative article and the archive with Search Console URL Inspection, confirm the submitted sitemap is processed, and check Bing Webmaster Tools for crawl or indexing failures. During the monthly review, monitor indexed pages, search queries, and referrals, alongside link and media health. Local HTTP checks establish crawlability; they cannot prove that an external engine has indexed the live site.

## Artifact delivery

- Record one complete action and its visible result with sample data in a dedicated demo workspace. Verify the feature and permissions in that environment first. Use the product's normal theme and typography. Keep the cursor and text readable; crop around the relevant controls while preserving enough context to understand the action.
- Export an H.264 MP4 at a readable resolution, usually 1280×720 or 1920×1080. Keep it about 20–45 seconds and optimize it for web playback with `+faststart`. Prefer a focused demonstration with native playback controls over a decorative loop. Check the final crop on a 390px-wide screen.
- Take screenshots and the poster from the reviewed product capture. Choose a frame that shows the announced result, with a legible 16:9 crop for the story card. A separate 1200×630 share image can use the same frame with enough safe area for cropping. Keep the headline and benefit in the page's HTML rather than baking them into the image. Compress local JPEG, WebP, or PNG assets and retain actual screenshot dimensions in MDX.
- Use immutable, versioned media filenames, such as `compare-workflow-deployments-v1.mp4`. Upload recordings and spoken captions under `changelog/` in the existing public Academy asset store: `https://nnjgp7vypgx4myuq.public.blob.vercel-storage.com`. Put the returned public URLs in the entry. The app CSP and content audit explicitly allow this origin for recordings and captions. Small optimized walkthroughs under 1 MiB can live in `public/changelog/` and deploy atomically with their entry. Use the CDN for larger recordings. The component does not upload or proxy videos.
- Serve MP4s as `video/mp4` and spoken captions as `text/vtt`. The existing CDN supports HTTP Range requests, cross-origin playback, and caching. Use a new filename for every revision and verify those response headers on the uploaded asset. Do not overwrite an existing recording URL.
- In the deployment preview, check playback, seeking, captions, poster loading, and mobile readability. A silent recording uses the component's muted default. Spoken recordings need a WebVTT file.
- Generate social and email drafts from the reviewed product story: capability, practical benefit, and one link to the canonical entry. Use the same claims and restrictions everywhere. Keep distribution manual until the format and review process are established.

AI can prepare storyboards, copy, captions, and clearly labeled conceptual diagrams. Screenshots and feature recordings must come from the real product. Do not generate fictional controls, results, performance numbers, or before-and-after evidence. Label a walkthrough assembled from still captures as a step-by-step walkthrough; do not describe it as a continuous recording. Keep its UI frames unmodified and record the assembly method in the production brief.

Optional local encoding, once a real recording exists:

```bash
ffmpeg -i recording.mov -vf "scale=1280:-2" -c:v libx264 -crf 23 -preset medium -pix_fmt yuv420p -c:a aac -movflags +faststart compare-workflow-deployments-v1.mp4
ffmpeg -ss 25 -i compare-workflow-deployments-v1.mp4 -frames:v 1 -q:v 2 compare-workflow-deployments-poster.jpg
```

Choose the poster timestamp after reviewing the exported recording; `25` is an example, not a required frame. Check the compressed result rather than only the original recording.

## Entry template

```mdx
---
slug: your-update
title: 'A concrete product headline'
description: 'Explain the new capability and the situation where it helps a team using Sim.'
date: '2026-10-07T18:00:00Z'
authors: [waleed]
tags: [Workflows]
ogImage: /changelog/your-update-poster.jpg
ogAlt: 'Describe the actual product view'
draft: true
technical: false
release:
  versions: [v0.9.14]
  url: https://github.com/simstudioai/sim/releases/tag/v0.9.14
---

<ChangelogVideo
  src="https://nnjgp7vypgx4myuq.public.blob.vercel-storage.com/changelog/demo-v1.mp4"
  poster="/changelog/your-update-poster.jpg"
  caption="Describe the action and result shown in the demo."
  captionsSrc="https://nnjgp7vypgx4myuq.public.blob.vercel-storage.com/changelog/demo-v1.vtt"
/>

Explain where to find the feature and give one concrete example.

### Improvements

- Describe a noticeable improvement.

### Fixes

- Describe the situation that now works correctly.
```

## Review and media

1. Check the source PRs and verify availability in the deployed product. A merge or GitHub release does not prove Cloud availability. Mention Enterprise restrictions and the minimum self-hosted version when relevant.
2. Use a dedicated demo workspace. Record one action from start to result in roughly 20–45 seconds, with readable text and sample data.
3. Use compressed MP4s on the approved public CDN, plus a local poster image, or same-origin MP4s under 1 MiB. Do not commit large recordings. Add WebVTT captions on the same origin for spoken recordings; omit `captionsSrc` for silent recordings. A different media provider needs an explicit CSP and content-audit change before use.
4. Use `<ChangelogImage src="/changelog/example.png" alt="Describe the view" width="1200" height="800" />` for a screenshot, supplying its actual dimensions as literal attributes to reserve space during loading. The MDX compiler strips JavaScript expressions such as `width={1200}`. Describe what it actually shows; do not use an older screenshot as proof of a new control.
5. Use `###` for sections inside an entry: the article owns the H1 and its details section owns an accessible H2.
6. Keep `draft: true` until the text, availability, media, and links are reviewed. Drafts are excluded from the public page, direct entry routes, archive, sitemap, and RSS. Use the development preview to review them without changing publication status.
7. Publish by removing the draft flag or setting it to false, then deploy the site. Keep the slug and original publication date stable. Add `updated` only for a substantive correction.

Before merging, run `bun run check:library-content --slug changelog/<slug>` from the repository root. The shared content audit checks frontmatter, authors, folder slugs, reserved routes, images, MDX syntax, internal links, changelog media attributes, and the existence of local recordings and caption files. Published entries also require body media and descriptive cover alt text; future publication dates, correction dates before publication, and duplicate RSS identities fail the audit. `bun run check:audits` runs it in CI. It cannot determine whether an image proves a feature or confirm Cloud rollout, codec quality, or CDN availability; the feature owner and editor verify those in the brief and preview.

For a migrated historical release, use its original publication timestamp and GitHub release URL. RSS retains that URL as its identifier to avoid announcing the same release twice. For a new editorial edition covering multiple releases, omit `release.url` and link to the technical releases in the body, so its RSS identity is its unique canonical URL.

## Maintenance

- The release editor reviews candidates weekly and checks published links and hosted media monthly. Refresh destinations when docs move and verify deep anchors manually; the audit catches missing canonical source pages during every PR.
- Keep the original slug, publication date, and RSS identity stable. Use `updated` only for a substantive correction. A future date does not schedule publication; leave the entry in draft until the intended deployment.
- If availability changes after publication, update the existing entry with its current status and a clear next step. Preserve its URL rather than deleting it or reverting it to a draft. If a slug must change, add a redirect before moving it.
- Keep historical media versioned. Record the capture date, environment, demonstrated steps, and final asset URLs in the brief. Never overwrite an existing recording. Recheck playback, seeking, captions, and mobile readability after any replacement.
- RSS includes the 50 latest published entries, the homepage shows 12, and the archive retains the published history. Those collections load metadata and optimized covers; full articles and recordings load on their detail pages.
- Draft preparation can be assisted by Codex. Publication and distribution remain deliberate editorial actions; there is no automatic commit-to-changelog or auto-send job.
