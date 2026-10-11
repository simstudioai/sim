# Changelog editorial and media standard

Use this contract for the Sim drafting workflow and the final editorial review. The publishing guide owns the MDX format, media hosting, and release checks. This standard owns selection, copy, and demonstration quality.

## Choose the right-sized story

A standalone update needs a meaningful capability, a substantial improvement to an existing task, or an action-required notice. State what a team can do, the situation it helps with, and how the proposed media will demonstrate it.

Routine retry fixes, loading improvements, internal refactors, and small polish belong in a related edition's short Improvements or Fixes section. Keep unrelated maintenance in the technical release history. A batch of commits is not a story. Defer a batch with only supporting notes instead of padding it into a launch. An urgent breaking change needs a timely notice and a verified explanatory image when there is no useful product screen.

Keep existing article URLs, original dates, and RSS identities when refining historical copy. Do not merge existing entries just to make a larger announcement. Preserve material version, permission, and rollout restrictions.

## Write a compact entry

- Headline: name the capability or action, at most 65 characters. Avoid generic headlines such as “A better experience.”
- Summary: 15–40 words for search, sharing, and RSS, naming Sim and explaining the capability in plain language. It must make sense without the image.
- Body: lead with what changed and what teams can do with it. Aim for 2–4 short sentences, usually 30–90 words, followed by a useful documentation link. There is no minimum word count; keep the body under 120 words. Use one concrete example when it adds clarity. Save setup instructions for the linked guide; do not pad a simple update into a tutorial.
- Media: place the reviewed image or video immediately after the article header. Both use the shared lightbox; videos show a plain poster with playback, seeking, and zoom controls inside the viewer. Use concise alt text or an accessible action label without a visible video description. Do not add captions or prose about how the capture was made, whether a query ran, sample credentials, or what a screenshot does not prove. Keep capture provenance and review evidence in production.md.
- Supporting notes: up to three related, source-backed improvements, each one sentence. Omit empty sections. Do not invent extras to fill a template.
- Links: one descriptive setup/documentation link, plus an integration, model, or product link when directly relevant. Use the actual catalog slug and guide. Put links in context; avoid a wall of generic “Learn more” links.
- Availability: keep restrictions that affect whether someone can use the feature, such as a required plan or administrator role, in one concise sentence. Link to documentation for setup details. Keep unverified rollout questions, source analysis, capture instructions, and approval checkboxes in production.md. Never substitute a capture disclaimer for verifying a claim.

Use short active sentences and familiar words. Technical identifiers, retry timings, queue keys, PR numbers, and performance claims without measurements do not belong in the article. There is no minimum number of announcements per week.

## Make the media prove one thing

Choose the format before capture. A screenshot suits a state or configuration. A 20–45 second recording suits an interaction. A clearly labeled, verified diagram suits an invisible system change. Generated art can explain a concept, but cannot stand in for product evidence.

Every production brief records:

1. The exact claim and what the demonstration does not establish.
2. The starting state, permissions, sample data, action, and visible result.
3. The chosen format and, for video, intended duration and a short sequence of shots.
4. The result frame to use as a poster and the intended crop or framing.
5. The real capture environment, build, date, source files, and reviewed final filenames.

Use the same clean demo workspace and product theme. Frame the relevant panel with enough context to locate it, and make the result legible at a 390px viewport. Hide unrelated private sidebar content before recording. Keep UI text and controls intact; never generate a different product state to improve a screenshot. Prefer recording at the intended framing over aggressive crops later.

Begin with the task ready to perform, show the action, and hold on its result. Avoid decorative intros, music, title cards, and excessive cursor movement. Keep the headline and important explanation in HTML. Record videos assembled from still screenshots as edited walkthroughs in the production brief; do not describe them as continuous recordings in public copy.

Choose the poster deliberately after reviewing the video. An opening menu, empty state, spinner, or arbitrary first second rarely explains the feature. The media workflow can provide candidate frames, but an editor selects the final timestamp. Preview candidates are not approved assets. Preserve the real aspect ratio inside the shared media frame; do not stretch product UI. Use the same reviewed result frame for the article poster and share image when it works in both contexts.

The page's shared landing components supply typography, theme colors, spacing, and radius. Do not add a separate visual theme to each entry or bake decorative headings and chrome into captures. Provide descriptive alt text and reviewed WebVTT captions when there is speech.

## Review the finished entry

The workflow checks the proposed copy against source evidence in a second editorial pass, then validates structure, source references, the link allowlist, word budgets, and the media plan. These checks do not establish the truth of every claim or the quality of a capture. The editor and feature owner review the article and media together: accurate behavior, confirmed availability, useful next step, readable framing, correct poster, working playback and links, and consistent copy across the page and announcement drafts.

Add approved media and index.mdx to the same draft PR. Keep draft: true until review is complete. Do not create placeholder media paths to make an incomplete brief look finished. Follow the publishing guide's content audit and normal repository checks, then verify the deployed article, media, RSS, and sitemap before distribution.
