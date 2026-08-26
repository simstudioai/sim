---
name: knowledge-base
description: Create and operate Sim knowledge bases through the sim CLI. Use when configuring chunking, ingesting local or workspace documents, setting up connectors, managing tags or chunks, and verifying retrieval; not for ordinary table data or workflow graph edits.
---

# Operate a Sim Knowledge Base

Build retrieval from an explicit ingestion source, wait for indexing to finish, and verify it with a
query whose expected answer is present in the source material.

## Establish context

- Use the profile the user named. If none was named, inspect configured profiles and current context;
  do not silently switch accounts, workspaces, or API origins.
- Find existing resources with `sim --output json knowledge list`. Read the target with
  `sim --output json knowledge get <knowledgeBaseId>` before changing it.
- Keep ids returned by create, upload, and connector calls. Do not rediscover resources by display
  name when an exact id is available.

## Create with intentional chunking

For ordinary documents, begin with the server defaults unless the user has a retrieval reason to
change them:

```bash
sim --output json knowledge create \
  --name "Support handbook" \
  --description "Approved support policies"
```

When tuning is required, pass `--chunking-config @chunking.json`. The object accepts `maxSize`,
`minSize`, `overlap`, `strategy`, and strategy-specific `strategyOptions`; inspect
`knowledge create --help` and the current knowledge-base response before composing it. Valid
strategies are `auto`, `text`, `regex`, `recursive`, `sentence`, and `token`. A regex strategy
requires a pattern. Fail on invalid bounds instead of silently falling back to defaults.

Chunking changes affect subsequent processing. Do not imply that updating the knowledge base has
re-indexed existing completed documents unless those documents were explicitly reprocessed.

## Choose one ingestion path

For a local file, upload it directly:

```bash
sim --output json knowledge documents upload <knowledgeBaseId> ./handbook.pdf
```

Use `--name`, `--recipe`, or `--lang` only when supplied or justified by the source. `--tag` values
map positionally to text slots `tag1` through `tag7`; define and inspect semantic tags first rather
than guessing slot meanings.

For files already stored in the workspace, use `knowledge from-workspace-files create` so the
server reads the canonical file. For a continuously changing external source, use a connector:

1. Run `sim --output json connector-types list` and select an exact `connectorType`.
2. Read its returned `auth` mode and `configFields`. Build `sourceConfig` using each field's id or
   `canonicalParamId`, honoring `required`, `dependsOn`, and `multi`.
3. Supply an existing OAuth `credentialId` or the required API key without writing the secret to a
   committed file or output.
4. Create it with `knowledge connectors create`, then start an explicit sync with
   `knowledge connectors sync` when needed.

Never invent provider-specific `sourceConfig`. Do not use `--rehydrate` unless the user intends to
re-fetch and re-index every existing connector document.

## Wait for indexing

Upload and sync acceptance are not retrieval success. Read documents with:

```bash
sim --output json knowledge documents list <knowledgeBaseId> \
  --sort-by processingStatus --sort-order asc --limit 100
```

For an exact item, use `knowledge documents get <knowledgeBaseId> <documentId>`. A document is
searchable only when it is enabled and `processingStatus` is `completed`. Treat `pending` and
`processing` as nonterminal, and `failed` as a real failure. Use `documents update --retry-processing`
alone only for a failed or stuck document; do not combine that flag with metadata changes.

For connectors, inspect `knowledge connectors list` and `knowledge connectors documents list` to
distinguish connector sync state from individual document processing. Poll with a bounded stopping
condition and report remaining nonterminal or failed items.

## Define and filter tags semantically

List definitions with `knowledge tags list`. Create or save a definition before assigning values,
using `knowledge tags next-slot` when a slot is not already chosen. Text, number, date, and boolean
tags use separate finite slot pools.

Search and document-list filters use the tag's display name, not its storage slot:

```json
[{ "tagName": "category", "operator": "eq", "value": "billing" }]
```

All filters in one request must match. A missing tag name or inconsistent definition across selected
knowledge bases is an error, never an ignored filter.

## Verify retrieval

Run a bounded search after documents reach `completed`:

```bash
sim --output json knowledge search \
  --kb <knowledgeBaseId> \
  --query "How are billing disputes escalated?" \
  --top-k 5 \
  --search-mode hybrid
```

`top-k` must be a whole number from 1 through 100. Use `vector` for semantic retrieval and `hybrid`
when exact terminology should also influence ranking. Enable reranking only when its extra billed
search unit is justified; it is best-effort, so inspect `rerankerStatus` rather than assuming it ran.

Verify that returned chunks come from the intended document and contain evidence for a known answer.
An empty result while a document is still indexing is not proof that retrieval is misconfigured.
If completed content is absent, inspect enabled state, tag filters, chunk text, and chunking config;
do not hide a deterministic ingestion or filter error by changing query wording repeatedly.

## Verify and report

Report the knowledge-base id, its exact `webUrl` from the create or get response as a clickable link,
ingestion path, document and connector ids, terminal processing statuses, and a concise retrieval
result. Do not construct a knowledge-base URL from ids or the profile's API origin; a missing
`webUrl` is a response-contract failure. Identify any failed document or degraded reranker status.
Never print API keys, OAuth tokens, unrelated document content, or profile credentials.
