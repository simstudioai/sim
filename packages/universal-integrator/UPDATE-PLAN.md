# Integrator v8 - Complete Sim.ai Integration Generator

## Current Status (v7)
✓ Generates Tools (ToolConfig)
✓ Generates Block (BlockConfig) - basic
✓ Generates TypeScript types
✓ Registers in registry
✓ Uses DeepSeek for cost savings

## What v8 Will Add

### Phase 1: Analyze (ENHANCED)
- ✓ API info, auth model (existing)
- **NEW**: webhook support detection
- **NEW**: OAuth scope requirements
- **NEW**: file upload/download support
- **NEW**: dynamic resource requirements
- **NEW**: catalog visibility decision

### Phase 4: Design (ENHANCED)
- **NEW**: Decision matrix
  - Single operation vs grouped?
  - Tool count → determines block design
  - Has webhooks → triggers?
  - Has OAuth → centralize scopes?
  - Has files → internal routes?
  - Catalog visible → BlockMeta?

### Phase 5-6: TOOLS & BLOCK (IMPROVED)
- ✓ Generate tools (existing)
- **NEW**: Validate visibility (not guessed)
- **NEW**: Validate outputs (not guessed)
- **NEW**: Block operation dropdown (grouped)
- **NEW**: Block subBlocks mapping to tool params
- **NEW**: Block triggers.available (if webhooks)
- **NEW**: Block authMode + auth subBlocks

### Phase 7: TRIGGERS (NEW)
- If service has webhooks:
  - Generate webhook trigger
  - Generate event-specific parsers
  - Generate signature verification
  - Register in trigger registry

### Phase 8: AUTH (NEW)
- If OAuth:
  - Add provider to lib/oauth/oauth.ts
  - Define centralized scopes
  - Add scope descriptions
- If ApiKey/BotToken:
  - Ensure user-only visibility
  - Add hidden token params to tools

### Phase 9: FILE HANDLING (NEW)
- If service has files:
  - Generate internal API routes
  - Generate normalizeFileInput
  - Generate file-upload subBlocks
  - Generate FileToolProcessor

### Phase 10: METADATA & CATALOG (NEW)
- Generate BlockMeta:
  - tags (CRM, Communication, etc)
  - templates (example workflows)
  - skills (suggested actions)
- Update integrations.json (catalog)
- Generate catalog entry

### Phase 11: DOCS (NEW)
- Run bun run scripts/generate-docs.ts
- Creates apps/docs/content/docs/en/integrations/{service}.mdx

### Phase 12: ICONS (NEW)
- Add {Service}Icon to apps/sim/components/icons.tsx

### Phase 13: VALIDATE (ENHANCED)
- ✓ All files created (existing)
- **NEW**: All tools registered
- **NEW**: All tools have real outputs (not guessed)
- **NEW**: All tool params have correct visibility
- **NEW**: Block operation dropdown has all tools
- **NEW**: All triggers registered (if webhooks)
- **NEW**: OAuth provider centralized (if OAuth)
- **NEW**: type-check passes
- **NEW**: No forbidden patterns (group, random visibility, etc)

## Implementation Order

1. **Extend Phase 1 (analyze)**
   - Add webhook detection
   - Add OAuth detection
   - Add file upload detection
   - Add dynamic resource detection

2. **Implement Phase 4 (design) - decision matrix**
   - What is tool count?
   - Should this be grouped block or simple?
   - Need triggers?
   - Need OAuth?
   - Need files?
   - Catalog visible?

3. **Enhance Phase 5-6 (tools & block)**
   - Validate visibility (ask DeepSeek)
   - Validate outputs (check API docs)
   - Generate block with operation dropdown
   - Map block params to tool params
   - Add triggers.available

4. **Add Phase 7 (triggers)**
   - If webhooks: generate webhook trigger
   - If webhooks: generate event parsers
   - Register in trigger registry

5. **Add Phase 8 (auth)**
   - If OAuth: add to lib/oauth/oauth.ts
   - If OAuth: centralize scopes
   - Ensure user-only for credentials

6. **Add Phase 9 (files)**
   - If files: generate internal routes
   - If files: generate file subBlocks
   - If files: generate processors

7. **Add Phase 10 (metadata)**
   - Generate BlockMeta
   - Add templates
   - Add skills
   - Add tags

8. **Add Phase 11 (docs)**
   - Run docs generator
   - Verify generated docs

9. **Add Phase 12 (icons)**
   - Add icon to icons.tsx

10. **Enhance Phase 13 (validate)**
    - Check all outputs are real
    - Check all visibility is correct
    - Check no guessed schemas
    - Run type-check

## File Changes Needed

NEW files to create:
```
apps/sim/tools/{service}/{action}.ts        (per tool)
apps/sim/tools/{service}/types.ts
apps/sim/blocks/blocks/{service}.ts
apps/sim/triggers/{service}/webhook.ts      (if webhooks)
apps/sim/app/api/tools/{service}/{action}/route.ts  (if files)
```

Files to MODIFY:
```
apps/sim/tools/registry.ts
apps/sim/blocks/registry.ts
apps/sim/triggers/registry.ts                (if webhooks)
apps/sim/components/icons.tsx               (if icon needed)
apps/sim/lib/oauth/oauth.ts                 (if OAuth)
integrations.json                           (catalog entry)
```

GENERATED:
```
apps/docs/content/docs/en/integrations/{service}.mdx
```

## Cost Savings

- v6 (Anthropic): $10-15 per integration
- v7 (DeepSeek): $0.50-1.00 per integration
- v8 (DeepSeek, more calls): $1.50-2.50 per integration (still 90%+ cheaper)

Trade-off: slightly higher DeepSeek cost, but 100% complete & correct integrations.

## Success Criteria for v8

✓ All 6 layers generated
✓ Block has operation dropdown (not separate blocks)
✓ All tools have real, documented outputs
✓ All tool params have correct visibility
✓ No guessed schemas
✓ Triggers registered if webhooks
✓ OAuth centralized if needed
✓ File routes internal if files
✓ BlockMeta + catalog
✓ Docs generated
✓ type-check passes
✓ Validates exhaustively
