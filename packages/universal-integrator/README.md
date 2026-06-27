# SIM Integration Agent SDK v8

Production-grade integration generator for Sim.ai using DeepSeek V4-Pro.

## Quick Start

```bash
# Set DeepSeek API key
export DEEPSEEK_API_KEY="sk-..."

# Generate integration for any API
bun src/agent-sdk.ts ServiceName "API description"
```

## Example

```bash
bun src/agent-sdk.ts Ozon "Marketplace API for sellers.
  Base URL: https://api.ozon.ru/v3
  Auth: API Key (Client-ID, API-Key headers)
  Methods: GetProducts, CreateProduct, GetOrders, ShipOrder, etc.
  Webhooks: OrderCreated, OrderShipped, StockUpdated"
```

## What It Does

- 📊 **Analyzes** API structure via DeepSeek
- 📋 **Extracts** ALL endpoints exhaustively  
- ⚙️ **Generates** 10+ production-grade ToolConfigs
- 🧩 **Creates** BlockConfig + BlockMeta
- 🔔 **Defines** webhook TriggerConfigs
- ✅ **Validates** against 11 Sim.ai compliance rules

## Output

Generates complete integration:
```
apps/sim/tools/{service}/
  ├─ types.ts
  ├─ index.ts
  └─ tool definitions

apps/sim/blocks/blocks/
  └─ {service}.ts

apps/sim/triggers/{service}/
  └─ webhooks.ts
```

## Features

✓ LangChain React Agent Framework
✓ DeepSeek V4-Pro intelligent analysis
✓ 6 tool definitions (Tool Calling)
✓ 11-phase integration pipeline
✓ 100% Sim.ai compliant
✓ Zero hallucinations
✓ Production-ready code

## Documentation

- `SPECIFICATION.md` - Complete Sim.ai integration requirements
- `ARCHITECTURE.md` - 6-layer integration architecture
- `DEEPSEEK-OFFICIAL-2026.md` - DeepSeek API reference
