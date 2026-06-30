<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **qinglong** (2740 symbols, 6583 relationships, 230 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "develop"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/qinglong/context` | Codebase overview, check index freshness |
| `gitnexus://repo/qinglong/clusters` | All functional areas |
| `gitnexus://repo/qinglong/processes` | All execution flows |
| `gitnexus://repo/qinglong/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

# Docker 构建 / 部署注意事项（踩过的坑，勿重复）

运行镜像 = 官方 `whyour/qinglong:latest`，自带一套 **pnpm 式** `/ql/node_modules`。
本仓库的 `docker/Dockerfile.fbd` 是多阶段：build 阶段（node:18 + pnpm）编译前后端，
最终阶段只把**编译产物**和**个别运行时包**COPY 进官方镜像。由此带来几条硬约束：

- **新增运行时 npm 依赖，改根 `package.json` + 重建镜像是不够的。** build 阶段装的依赖不会自动进运行镜像 —— Dockerfile 只 COPY 了 `static/build`、`static/dist` 和少数包（如 bcryptjs、tedious）。新增运行时依赖必须在 Dockerfile 里显式安排进 `/ql`。
- **不要在 `/ql` 上跑 `npm install`。** `/ql/node_modules` 是 pnpm 符号链接布局，npm 会崩（`Cannot read properties of null (reading 'matches')`）；`--legacy-peer-deps` 也救不了。
- **加原生/传递依赖多的运行时包的正确姿势**（见 tedious）：build 阶段用 `npm` 把它**扁平**装到独立目录（`npm init -y && npm install <pkg>`），再 `COPY --from=build /tdinstall/node_modules/ /ql/fbd_modules/node_modules/`。**必须落在 `node_modules` 子目录**，否则该包的传递依赖（如 `@azure/identity`）解析不到。代码侧用 sequelize 的 `dialectModule` 选项或 `require('/ql/fbd_modules/node_modules/<pkg>')` 显式加载，并对本地开发做 `require('<pkg>')` 兜底。
- **直接合并进 `/ql/node_modules` 会失败**：扁平目录与 pnpm 顶层符号链接冲突（`cannot copy to non-directory: .../node_modules/iconv-lite`）。所以才放独立目录。

验证习惯：
- 验证镜像本身用 `docker run --rm --entrypoint sh fbd-job-center:latest -c '...'`，别只看容器。
- `docker compose build | tail` 会**吞掉退出码**（拿到的是 tail 的 0）。要判断成败用 `docker compose build > log 2>&1; echo "exit=$?"`。
- `docker compose up -d` 不一定重建容器（可能显示 “Running” 沿用旧镜像）；换镜像后用 `--force-recreate`。
- SQLite `.sync()` 不会给已存在的表加列；新增列要在 `back/loaders/db.ts` 的 `migrations` 数组里补 `alter table add column`。