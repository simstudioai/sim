# LiteLLM Integration - Remaining Work

## Current Status

**Completed**: LiteLLM provider works for **Agent blocks** in workflows.

**Pending**: LiteLLM integration with **Copilot** (sim.ai's AI assistant).

---

## What's Done

- LiteLLM provider implementation (`providers/litellm/`)
- API route for model discovery (`/api/providers/litellm/models`)
- Environment variables (`LITELLM_BASE_URL`, `LITELLM_API_KEY`)
- Full tool execution and streaming support
- Provider registered in store and registry

---

## Remaining: Copilot Integration

The Copilot has a hardcoded model list separate from the provider system. To enable LiteLLM models in the Copilot, modify these files:

### 1. Add LiteLLM to valid provider IDs

**File**: `apps/sim/lib/copilot/config.ts`

Add `'litellm'` to `VALID_PROVIDER_IDS`:

```typescript
const VALID_PROVIDER_IDS = [
  'openai',
  'azure-openai',
  'anthropic',
  'google',
  'deepseek',
  'xai',
  'cerebras',
  'mistral',
  'groq',
  'ollama',
  'litellm',  // ADD THIS
] as const
```

### 2. Update Copilot model options (Frontend)

**File**: `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/constants.ts`

Option A - Add static LiteLLM entry:
```typescript
export const MODEL_OPTIONS = [
  // ... existing options
  { value: 'litellm/default', label: 'LiteLLM', provider: 'litellm' },
]
```

Option B - Make model list dynamic by fetching from provider store.

### 3. Update API validation schema

**File**: `apps/sim/app/api/copilot/chat/route.ts`

Update `ChatMessageSchema` to accept LiteLLM models. Find the `model` field validation and either:

- Add a regex pattern for `litellm/*` models
- Or dynamically validate against available provider models

### 4. Update Copilot state types

**File**: `apps/sim/stores/panel/copilot/types.ts`

Update the `selectedModel` type in `CopilotState` to include LiteLLM model pattern:

```typescript
selectedModel: 'claude-4.5-opus' | 'claude-4.5-sonnet' | /* ... */ | `litellm/${string}`
```

---

## Testing Checklist

After implementing Copilot integration:

- [ ] LiteLLM models appear in Copilot model selector
- [ ] Can select and use LiteLLM model in Copilot chat
- [ ] Streaming works in Copilot with LiteLLM
- [ ] Run `bun run lint && bun run type-check`

---

## Submitting the PR

### 1. Push to your fork

```bash
git push origin feat/litellm-provider
```

### 2. Create Pull Request

Go to: https://github.com/simstudioai/sim/compare

- Click "compare across forks"
- Base repository: `simstudioai/sim`
- Base branch: `staging` (NOT `main`)
- Head repository: `adityapuranik99/sim`
- Compare branch: `feat/litellm-provider`

### 3. PR Template

**Title**: `feat(providers): add LiteLLM provider integration`

**Body**:
```markdown
## Summary
- Add LiteLLM as a new provider for Sim
- Enables connecting LiteLLM proxy to access 100+ LLM providers (including GitHub Copilot)
- Uses OpenAI-compatible API pattern

## Changes
- New provider: `apps/sim/providers/litellm/`
- New API route: `apps/sim/app/api/providers/litellm/models/`
- Environment variables: `LITELLM_BASE_URL`, `LITELLM_API_KEY`

## Test plan
- [ ] Set `LITELLM_BASE_URL` in .env
- [ ] Verify models appear with `litellm/` prefix in Agent block
- [ ] Test chat completion through Agent block
- [ ] Verify streaming works
- [ ] Run `bun run lint && bun run type-check`

## Note
This PR enables LiteLLM for Agent blocks. Copilot integration can be added in a follow-up PR.
```

---

## Environment Setup

To test LiteLLM locally, add to `apps/sim/.env`:

```bash
LITELLM_BASE_URL=http://localhost:4000
LITELLM_API_KEY=sk-your-key  # optional
```

Start LiteLLM proxy:
```bash
pip install 'litellm[proxy]'
litellm --model gpt-4o --port 4000
```

---

## Questions?

- Discord: https://discord.gg/Hr4UWYEcTT
- GitHub Issues: https://github.com/simstudioai/sim/issues
