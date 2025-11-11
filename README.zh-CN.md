<p align="center">
  <a href="https://sim.ai" target="_blank" rel="noopener noreferrer">
    <img src="apps/sim/public/logo/reverse/text/large.png" alt="Sim Logo" width="500"/>
  </a>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">几分钟内构建和部署 AI 智能体工作流</p>

<p align="center">
  <a href="https://sim.ai" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/sim.ai-6F3DFA" alt="Sim.ai"></a>
  <a href="https://discord.gg/Hr4UWYEcTT" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Discord-Join%20Server-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://x.com/simdotai" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/twitter/follow/simstudioai?style=social" alt="Twitter"></a>
  <a href="https://docs.sim.ai" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Docs-6F3DFA.svg" alt="Documentation"></a>
</p>

<p align="center">
  <img src="apps/sim/public/static/demo.gif" alt="Sim Demo" width="800"/>
</p>

## 快速开始

### 云托管版本：[sim.ai](https://sim.ai)

<a href="https://sim.ai" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/sim.ai-6F3DFA?logo=data:image/svg%2bxml;base64,PHN2ZyB3aWR0aD0iNjE2IiBoZWlnaHQ9IjYxNiIgdmlld0JveD0iMCAwIDYxNiA2MTYiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxnIGNsaXAtcGF0aD0idXJsKCNjbGlwMF8xMTU5XzMxMykiPgo8cGF0aCBkPSJNNjE2IDBIMFY2MTZINjE2VjBaIiBmaWxsPSIjNkYzREZBIi8+CjxwYXRoIGQ9Ik04MyAzNjUuNTY3SDExM0MxMTMgMzczLjgwNSAxMTYgMzgwLjM3MyAxMjIgMzg1LjI3MkMxMjggMzg5Ljk0OCAxMzYuMTExIDM5Mi4yODUgMTQ2LjMzMyAzOTIuMjg1QzE1Ny40NDQgMzkyLjI4NSAxNjYgMzkwLjE3MSAxNzIgMzg1LjkzOUMxNzcuOTk5IDM4MS40ODcgMTgxIDM3NS41ODYgMTgxIDM2OC4yMzlDMTgxIDM2Mi44OTUgMTc5LjMzMyAzNTguNDQyIDE3NiAzNTQuODhDMTcyLjg4OSAzNTEuMzE4IDE2Ny4xMTEgMzQ4LjQyMiAxNTguNjY3IDM0Ni4xOTZMMTMwIDMzOS41MTdDMTE1LjU1NSAzMzUuOTU1IDEwNC43NzggMzMwLjQ5OSA5Ny42NjY1IDMyMy4xNTFDOTAuNzc3NSAzMTUuODA0IDg3LjMzMzQgMzA2LjExOSA4Ny4zMzM0IDI5NC4wOTZDODcuMzMzNCAyODQuMDc2IDg5Ljg4OSAyNzUuMzkyIDk0Ljk5OTYgMjY4LjA0NUMxMDAuMzMzIDI2MC42OTcgMTA3LjU1NSAyNTUuMDIgMTE2LjY2NiAyNTEuMDEyQzEyNiAyNDcuMDA0IDEzNi42NjcgMjQ1IDE0OC42NjYgMjQ1QzE2MC42NjcgMjQ1IDE3MSAyNDcuMTE2IDE3OS42NjcgMjUxLjM0NkMxODguNTU1IDI1NS41NzYgMTk1LjQ0NCAyNjEuNDc3IDIwMC4zMzMgMjY5LjA0N0MyMDUuNDQ0IDI3Ni42MTcgMjA4LjExMSAyODUuNjM0IDIwOC4zMzMgMjk2LjA5OUgxNzguMzMzQzE3OC4xMTEgMjg3LjYzOCAxNzUuMzMzIDI4MS4wNyAxNjkuOTk5IDI3Ni4zOTRDMTY0LjY2NiAyNzEuNzE5IDE1Ny4yMjIgMjY5LjM4MSAxNDcuNjY3IDI2OS4zODFDMTM3Ljg4OSAyNjkuMzgxIDEzMC4zMzMgMjcxLjQ5NiAxMjUgMjc1LjcyNkMxMTkuNjY2IDI3OS45NTcgMTE3IDI4NS43NDYgMTE3IDI5My4wOTNDMTE3IDMwNC4wMDMgMTI1IDMxMS40NjIgMTQxIDMxNS40N0wxNjkuNjY3IDMyMi40ODNDMTgzLjQ0NSAzMjUuNiAxOTMuNzc4IDMzMC43MjIgMjAwLjY2NyAzMzcuODQ3QzIwNy41NTUgMzQ0Ljc0OSAyMTEgMzU0LjIxMiAyMTEgMzY2LjIzNUMyMTEgMzc2LjQ3NyAyMDguMjIyIDM4NS40OTQgMjAyLjY2NiAzOTMuMjg3QzE5Ny4xMTEgNDAwLjg1NyAxODkuNDQ0IDQwNi43NTggMTc5LjY2NyA0MTAuOTg5QzE3MC4xMTEgNDE0Ljk5NiAxNTguNzc4IDQxNyAxNDUuNjY3IDQxN0MxMjYuNTU1IDQxNyAxMTEuMzMzIDQxMi4zMjUgOTkuOTk5NyA0MDIuOTczQzg4LjY2NjggMzkzLjYyMSA4MyAzODEuMTUzIDgzIDM2NS41NjdaIiBmaWxsPSJ3aGl0ZSIvPgo8cGF0aCBkPSJNMjQ2IDI0OEgyNzlWNDE0SDI0NlYyNDhaIiBmaWxsPSJ3aGl0ZSIvPgo8cGF0aCBkPSJNMzE3IDI0OEg0MDdDNDIwLjMzMyAyNDggNDMxLjMzMyAyNTAuNjY5IDQ0MCAyNTYuMDA4QzQ0OC44ODkgMjYxLjEyNSA0NTYuMTExIDI2OC43MTggNDYxLjY2NyAyNzguNzg3QzQ2Ny4yMjIgMjg4Ljg1NiA0NzAgMzAwLjI4NyA0NzAgMzEzLjA3OUM0NzAgMzI2LjA5NCA0NjcuMTExIDMzNy41MjUgNDYxLjMzMyAzNDcuMzcyQzQ1NS43NzggMzU3LjIxOSA0NDguMzMzIDM2NC44MTMgNDM5IDM3MC4xNTJDNDI5LjY2NyAzNzUuMjcgNDE4Ljg4OSAzNzguMDUgNDA2LjY2NyAzNzguMzk0SDM1MFY0MTRIMzE3VjI0OFpNMzUwIDM0OS44NDZINDAyLjMzM0M0MTAuNTU2IDM0OS44NDYgNDE2Ljg4OSAzNDcuNTk0IDQyMS4zMzMgMzQzLjA4OUM0MjUuNzc4IDMzOC41ODUgNDI4IDMzMi4yNzMgNDI4IDMyNC4xNTNDNDI4IDMxNi4yNTUgNDI1Ljc3OCAzMDkuOTQyIDQyMS4zMzMgMzA1LjIxNUM0MTYuODg5IDMwMC40ODggNDEwLjU1NiAyOTguMTI0IDQwMi4zMzMgMjk4LjEyNEgzNTBWMzQ5Ljg0NloiIGZpbGw9IndoaXRlIi8+CjwvZz4KPGRlZnM+CjxjbGlwUGF0aCBpZD0iY2xpcDBfMTE1OV8zMTMiPgo8cmVjdCB3aWR0aD0iNjE2IiBoZWlnaHQ9IjYxNiIgZmlsbD0id2hpdGUiLz4KPC9jbGlwUGF0aD4KPC9kZWZzPgo8L3N2Zz4K" alt="Sim.ai"></a>

### 自托管：NPM 包

```bash
npx simstudio
```
→ http://localhost:3000

#### 注意事项
需要在您的机器上安装并运行 Docker。

#### 选项

| 标志 | 描述 |
|------|-------------|
| `-p, --port <port>` | 运行 Sim 的端口（默认 `3000`） |
| `--no-pull` | 跳过拉取最新 Docker 镜像 |

### 自托管：Docker Compose

```bash
# 克隆仓库
git clone https://github.com/simstudioai/sim.git

# 进入项目目录
cd sim

# 启动 Sim
docker compose -f docker-compose.prod.yml up -d
```

在 [http://localhost:3000/](http://localhost:3000/) 访问应用程序

#### 使用 Ollama 本地模型

使用 [Ollama](https://ollama.ai) 运行 Sim 的本地 AI 模型 - 无需外部 API：

```bash
# 使用 GPU 支持启动（自动下载 gemma3:4b 模型）
docker compose -f docker-compose.ollama.yml --profile setup up -d

# 仅使用 CPU 的系统：
docker compose -f docker-compose.ollama.yml --profile cpu --profile setup up -d
```

等待模型下载完成，然后访问 [http://localhost:3000](http://localhost:3000)。使用以下命令添加更多模型：
```bash
docker compose -f docker-compose.ollama.yml exec ollama ollama pull llama3.1:8b
```

### 自托管：开发容器

1. 使用 [Remote - Containers 扩展](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)打开 VS Code
2. 打开项目，在提示时点击"在容器中重新打开"
3. 在终端运行 `bun run dev:full` 或使用 `sim-start` 别名
   - 这将同时启动主应用程序和实时 socket 服务器

### 自托管：手动设置

**环境要求：**
- [Bun](https://bun.sh/) 运行时
- PostgreSQL 12+ 并安装 [pgvector 扩展](https://github.com/pgvector/pgvector)（AI 嵌入功能必需）

**注意：** Sim 使用向量嵌入实现知识库和语义搜索等 AI 功能，这需要 PostgreSQL 的 `pgvector` 扩展。

1. 克隆并安装依赖：

```bash
git clone https://github.com/simstudioai/sim.git
cd sim
bun install
```

2. 设置带 pgvector 的 PostgreSQL：

您需要安装带有 `vector` 扩展的 PostgreSQL 以支持嵌入功能。选择一个选项：

**选项 A：使用 Docker（推荐）**
```bash
# 启动带 pgvector 扩展的 PostgreSQL
docker run --name simstudio-db \
  -e POSTGRES_PASSWORD=your_password \
  -e POSTGRES_DB=simstudio \
  -p 5432:5432 -d \
  pgvector/pgvector:pg17
```

**选项 B：手动安装**
- 安装 PostgreSQL 12+ 和 pgvector 扩展
- 参见 [pgvector 安装指南](https://github.com/pgvector/pgvector#installation)

3. 设置环境变量：

```bash
cd apps/sim
cp .env.example .env  # 配置必需的变量（DATABASE_URL、BETTER_AUTH_SECRET、BETTER_AUTH_URL）
```

在 `.env` 文件中更新数据库 URL：
```bash
DATABASE_URL="postgresql://postgres:your_password@localhost:5432/simstudio"
```

4. 设置数据库：

首先，配置数据库包的环境变量：
```bash
cd packages/db
cp .env.example .env 
```

在 `packages/db/.env` 文件中更新数据库 URL：
```bash
DATABASE_URL="postgresql://postgres:your_password@localhost:5432/simstudio"
```

然后运行迁移：
```bash
bunx drizzle-kit migrate --config=./drizzle.config.ts
```

5. 启动开发服务器：

**推荐方式 - 同时运行两个服务器（从项目根目录）：**

```bash
bun run dev:full
```

这将同时启动主 Next.js 应用程序和完整功能所需的实时 socket 服务器。

**替代方式 - 分别运行服务器：**

Next.js 应用（从项目根目录）：
```bash
bun run dev
```

实时 socket 服务器（从 `apps/sim` 目录在单独的终端）：
```bash
cd apps/sim
bun run dev:sockets
```

## Copilot API 密钥

Copilot 是由 Sim 管理的服务。要在自托管实例上使用 Copilot：

- 访问 https://sim.ai → 设置 → Copilot 并生成 Copilot API 密钥
- 在您的自托管 apps/sim/.env 文件中将 `COPILOT_API_KEY` 环境变量设置为该值

## 技术栈

- **框架**：[Next.js](https://nextjs.org/)（App Router）
- **运行时**：[Bun](https://bun.sh/)
- **数据库**：PostgreSQL + [Drizzle ORM](https://orm.drizzle.team)
- **身份认证**：[Better Auth](https://better-auth.com)
- **UI**：[Shadcn](https://ui.shadcn.com/)、[Tailwind CSS](https://tailwindcss.com)
- **状态管理**：[Zustand](https://zustand-demo.pmnd.rs/)
- **流程编辑器**：[ReactFlow](https://reactflow.dev/)
- **文档**：[Fumadocs](https://fumadocs.vercel.app/)
- **单体仓库**：[Turborepo](https://turborepo.org/)
- **实时通信**：[Socket.io](https://socket.io/)
- **后台任务**：[Trigger.dev](https://trigger.dev/)
- **远程代码执行**：[E2B](https://www.e2b.dev/)

## 贡献

欢迎贡献！请查看我们的[贡献指南](.github/CONTRIBUTING.md)了解详情。

## 许可证

本项目采用 Apache License 2.0 许可证 - 详见 [LICENSE](LICENSE) 文件。

<p align="center">由 Sim 团队用 ❤️ 制作</p>
