# agent-sweep

[![CI](https://github.com/outerarc-ai/agent-sweep/actions/workflows/ci.yml/badge.svg)](https://github.com/outerarc-ai/agent-sweep/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/agent-sweep.svg)](https://www.npmjs.com/package/agent-sweep)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18.17.0-brightgreen.svg)](package.json)

跨 harness 的智能体残留工作区清理工具。扫描、复核并回收 AI 编程 Agent 在本机遗留的会话工作区、孤儿 git worktree 与应用缓存——覆盖 Claude Code、Codex CLI、Cursor、Trae、Windsurf、Copilot、Aider、Goose/OpenCode 等。

- **只读优先**：扫描、分析、计划三步不写盘；只有 `clean` 才可能改动磁盘。
- **可还原**：默认把对象移入本地回收站并留下还原清单，`restore` 一键回滚。
- **硬约束安全**：记忆文件、MCP 注册、凭据配置、活跃工作区进入「永不清理」圈层，任何参数都无法越权。
- **零外部依赖**：只用 Node 内置模块，无 `dependencies`，无 CDN 资源，报告为自包含 HTML；本地 Web UI 同样零依赖。
- **注册表驱动**：新增一个 harness 只需追加一份声明，扫描引擎无需改动。

## 为什么需要它

AI 编程 Agent 会把大量状态写到用户主目录：会话 JSONL、按天分层的 rollout、文件历史、图片/粘贴缓存、以及**孤儿 git worktree**。这些数据只增不减，且分散在十几套互不感知的目录约定里：

| 现象 | 典型规模 |
| --- | --- |
| 会话工作目录 / worktree 长期堆积 | 单个 harness 可达数十 GB |
| 宿主项目已删除，worktree 注册残留 | 指向不存在主仓库的「孤儿」 |
| IDE 缓存（Cache / CodeCache / GPUCache / logs） | 随使用时长线性增长 |
| 记忆 / 凭据 / MCP 配置与垃圾混居 | 误删即不可逆 |

agent-sweep 用一个统一的治理层把这些对象枚举出来，用**复合信号**判断哪些可以安全回收，并在动手前给出可审阅的计划。

## 安装

```bash
# 直接从源码运行，无需安装
node ./bin/agent-sweep.js scan

# 或全局安装
npm install -g agent-sweep
agent-sweep scan
```

要求 Node.js `>= 18.17.0`。支持 macOS / Linux / Windows。Windows 上有两处能力自动退化：进程占用检测不可用；会话目录的 `encoded-cwd` 孤儿判定不可用（该判定依赖 POSIX 路径编码），此时该目标按「未知」处理而非误判为孤儿。

## 快速开始

```bash
# 1. 只读扫描，看清家底（终端表格）
agent-sweep scan

# 2. 生成自包含 HTML 报告，便于分享与复核
agent-sweep scan --html report.html

# 3. 生成可审阅的清理计划（仍不写盘）
agent-sweep plan --include-review

# 4. 预演执行：完整走一遍复检与移动逻辑，但不落盘
agent-sweep clean --include-review --dry-run

# 5. 真正执行：移入回收站，可还原
agent-sweep clean --include-review --yes

# 6. 后悔了：从回收站还原
agent-sweep trash list
agent-sweep restore 20261012-114530-9qmh
```

## 实际效果

下面是一次真实环境（macOS，长期运行多个 AI 编程 Agent 的开发机）的 `scan` 输出摘录，全程只读、耗时约 7 秒：

```console
扫描概览
  平台 macOS · harness 8 个 · 候选单元 430 个 · 合计 8.90 GB
  可回收 2.33 GB（安全圈 1.98 GB · 待确认圈 359 MB）· 保护 770 MB

Harness                单元     合计   安全圈  待确认     保护   最旧  最新
─────────────────────  ────  ───────  ───────  ──────  ───────  ─────  ────
Trae / Trae CN / SOLO   396  8.90 GB  1.98 GB  359 MB   770 MB  8.3mo    1m
Copilot CLI (仅报告)     33  19.2 KB      0 B     0 B  19.2 KB    67d    2h
Claude Code               1  50 B       0 B     0 B      0 B    41d   41d

体积优先候选 Top 15（节选）
圈层              Harness                类型         体积   年龄  孤儿  路径
────────────────  ─────────────────────  ──────────  ─────  ─────  ────  ───────────────────────────────────────────
[1] 可安全清理    Trae / Trae CN / SOLO  cache        111 MB   76d    —    ~/Library/Application Support/Trae CN/CachedD…
[1] 可安全清理    Trae / Trae CN / SOLO  worktree     229 MB   31d  孤儿  ~/.trae-cn/worktrees/air/jaeger-otlp-setup-ra…
[1] 可安全清理    Trae / Trae CN / SOLO  cache         90.3 MB  3.2mo  —    ~/Library/Application Support/Trae CN/CachedD…
[2] 需确认后清理  Trae / Trae CN / SOLO  session-store  14.9 MB  3.1mo  —   ~/.trae-cn/work/6a50aa768f0da1f0e0e4a6f1
```

一眼能看清三件事：**总量**（430 个残留对象、8.90 GB）、**可回收量**（2.33 GB，其中 1.98 GB 可安全直接清理）、**被保护量**（770 MB 的记忆 / 凭据 / 活跃会话，任何参数都动不了）。孤儿 worktree（宿主项目已删除）与陈旧缓存会被自动标出。

同一份数据也可以：

- `agent-sweep scan --html report.html` — 生成自包含 HTML 报告分享
- `agent-sweep ui --open` — 在浏览器里勾选、预演、执行（下节）
- `agent-sweep clean --include-review --yes` — 执行清理，回收空间进入回收站可还原

## 本地 Web UI

不想记命令时，用本地 Web UI 走完整流程：

```bash
agent-sweep ui --open
```

浏览器打开 `http://127.0.0.1:7317/`，界面按五步组织，与 CLI 共用同一条流水线：

1. **扫描** — 勾选 harness、设定 TTL / 最小体积 / 最低评分，只读枚举候选。
2. **勾选** — 按圈层、harness、类型、评分与关键字筛选，逐项挑选要处理的对象；「永不清理」圈层与仅报告目标不出现在此列表中（数量与体积以提示行汇总展示）。
3. **预演** — 用与真实执行相同的规则复检每个对象，展示将被处理与被拦下的明细，不写盘。
4. **执行** — 选择「移入回收站」或「直接删除」（后者需输入 `DELETE` 二次确认），执行后展示释放量与 prune 结果。
5. **回收站** — 查看批次清单、还原预演与还原。

界面支持**中英双语**（中文 / English），侧边栏一键切换，选择会记入 `localStorage`，首次访问按浏览器语言自动判定。所有文案（含圈层、判定原因等后端机器码）都在前端本地化，无外部依赖。

安全边界与 CLI 完全一致，并额外加固：

- 仅监听 `127.0.0.1`（除非显式 `--host`），启动时生成**会话令牌**，所有 API 调用必须携带该令牌。
- 校验 `Origin`，拒绝跨站请求；静态资源做路径穿越防护。
- 服务端**永不信任前端提交的路径**：执行时按 id 在服务端重建计划，并再次复核安全硬约束与进程占用。
- 直接删除需要请求体中的 `confirmText: "DELETE"`，与界面上的输入确认双重把关。

| 选项 | 说明 |
| --- | --- |
| `--port <n>` | 监听端口（默认 `7317`） |
| `--host <addr>` | 绑定地址（默认 `127.0.0.1`；非回环地址会打印告警） |
| `--open` | 启动后自动打开浏览器 |

扫描相关选项（`--harness` / `--ttl` / `--min-size` / `--no-active-check` / `--trash-root` 等）同样作为 Web UI 的默认值生效。

## 安全模型：三圈层

每个候选单元都会被划入且只划入一个圈层。圈层是**执行前的最后一道闸门**，独立于评分。

| 圈层 | 含义 | 默认是否执行 |
| --- | --- | --- |
| **第 1 圈 · 可安全清理** | 孤儿 worktree、陈旧缓存、日志、缩略图 | ✅ 默认执行 |
| **第 2 圈 · 需确认后清理** | 陈旧但仍含不确定性的会话数据 | ⚠️ 需 `--include-review` |
| **第 3 圈 · 永不清理** | 记忆、凭据、MCP 注册、插件、活跃占用、仅报告目标 | ⛔ 硬约束，任何参数都不越权 |

判定顺序（短路，先命中先决定）：

1. 命中显式护栏（`neverDelete` 或全局保护路径）→ 第 3 圈
2. 目标声明为 `removable: false`（仅报告）→ 第 3 圈
3. 命中进程占用（lsof 打开文件 / lock 文件）→ 第 3 圈
4. 未超过 TTL → 保留
5. 低于 `--min-size` → 保留
6. 孤儿 → 第 1 圈
7. 缓存 / 日志 / 缩略图 → 第 1 圈
8. 低风险陈旧对象 → 第 1 圈
9. 其余陈旧对象 → 第 2 圈

> 护栏是**目录级**的：文件名启发式（如 `.env`、`AGENTS.md`）只用于保护单个文件，绝不会因为一个会话目录里恰好有个 `.env.example` 就把整个目录判为受保护。子树的保护判定只认注册表里的显式路径。

## 支持的 harness

| ID | 名称 | 形态 | 默认 TTL | 风险 | 写入能力 |
| --- | --- | --- | --- | --- | --- |
| `claude-code` | Claude Code | CLI | 30d | medium | ✅ 可清理 |
| `codex` | Codex CLI | CLI | 60d | medium | ✅ 可清理 |
| `cursor` | Cursor | IDE | 30d | high | ✅ 可清理 |
| `trae` | Trae / Trae CN / SOLO | IDE | 30d | medium | ✅ 可清理 |
| `windsurf` | Windsurf / Devin | IDE | 90d | medium | 仅报告 |
| `copilot` | Copilot CLI | CLI | 60d | low | 仅报告 |
| `aider` | Aider | CLI | 90d | low | 仅报告 |
| `goose` | Goose / OpenCode | XDG | 60d | low | 仅报告 |

「仅报告」的 harness 会被完整扫描并在报告中呈现，但不会产生任何可执行动作——这是刻意的渐进式策略：先让用户看到规模，再决定是否开启写入。

查看完整注册表与每个目标的路径：

```bash
agent-sweep harnesses
agent-sweep harnesses trae --verbose
```

## 命令

| 命令 | 说明 |
| --- | --- |
| `scan` | 只读扫描并输出残留报告（默认命令） |
| `plan` | 生成可审阅的清理计划（只读） |
| `clean` | 执行清理（默认移入回收站，可还原） |
| `restore <batchId>` | 从回收站还原某一批次 |
| `trash [list\|empty]` | 查看或清空回收站 |
| `ui` | 启动本地 Web UI（扫描/勾选/预演/执行/还原 全流程） |
| `harnesses [id]` | 列出内置 harness 注册表 |
| `doctor` | 环境与注册表自检 |
| `help` / `version` | 帮助 / 版本 |

### 常用选项

| 选项 | 说明 |
| --- | --- |
| `--harness <id>` | 限定 harness（可重复，或逗号分隔） |
| `--ttl <days\|id=days>` | 覆盖 TTL，如 `--ttl 60` 或 `--ttl trae=45` |
| `--older-than <days>` | 等价于全局 `--ttl` |
| `--min-size <size>` | 动作体积下限，如 `--min-size 10MB` |
| `--min-score <n>` | 动作评分下限 |
| `--include-review` | 把第 2 圈也纳入动作 |
| `--safe-only` | 仅第 1 圈（默认） |
| `--dry-run, -n` | 只预演，不写盘 |
| `--yes, -y` | 跳过交互确认 |
| `--direct-delete` | 直接删除而非移入回收站（需 `--yes`） |
| `--no-prune` | 跳过 `git worktree prune` |
| `--no-active-check` | 跳过 lsof 进程占用检测 |
| `--json` | 以 JSON 输出 |
| `--html <file>` | 写出自包含 HTML 报告 |
| `--trash-root <path>` | 自定义回收站根目录 |
| `--concurrency <n>` | 并发测量数（默认 8） |
| `--port <n>` / `--host <addr>` / `--open` | 本地 Web UI 端口 / 绑定地址 / 自动打开浏览器 |
| `--verbose, -v` / `--quiet, -q` / `--no-color` | 日志与颜色控制 |

## 判定方法

年龄**不是**目录自身的 mtime，而是子树内**叶子文件的最大 mtime**——目录 mtime 会因为无关的子项增删而更新，叶子 mtime 才反映「最后一次真实写入」。再叠加三个信号，按体积加权评分排序：

| 信号 | 权重 | 说明 |
| --- | --- | --- |
| 体积 | 0.50 | 相对 `sizeCap`（默认 2 GB）归一 |
| 年龄 | 0.35 | 相对 `TTL × 3` 归一 |
| 孤儿 | 0.15 | worktree 主仓库缺失 / 会话宿主项目已删除 |

风险等级会带来惩罚项（low 0 / medium 0.05 / high 0.15），让高风险对象在同等体积下排后。

孤儿判定有两种：

- **git-worktree**：读取 worktree 内的 `.git` 指针文件，解析主仓库路径；主仓库或 gitdir 缺失即为孤儿。
- **encoded-cwd**：会话目录名是宿主项目路径的编码（`/` 替换为 `-`），逐段回探文件系统；无法还原即宿主项目已删除。

## 回收站与还原

`clean` 默认把对象 `rename` 到 `~/.agent-sweep/trash/<batchId>/files/`，并写入 `manifest.json`（含原始路径、体积、批次元数据）。跨卷时会自动退化为复制后删除。

- 还原：`agent-sweep restore <batchId>`（目标已存在则不覆盖，计入冲突）
- 清理回收站：`agent-sweep trash empty [--keep-days 7]`（不可还原，需 `--yes`）
- 删除 worktree 后，会对主仓库执行 `git worktree prune`，避免制造新的注册表残留

## 退出码

| 码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `1` | 执行过程中有失败项 / 自检未通过 |
| `2` | 参数或用法错误（如缺少 `--yes`、未知命令） |

## 开发

```bash
npm test        # Node 内置测试运行器，90+ 用例
npm run lint    # 零依赖静态检查（包卫生 / 模块可加载 / 源码启发式 / i18n 键覆盖）
npm run check   # 端到端自检：合成 fixture 上跑完整流水线 + 回收/还原往返
```

三个脚本都不依赖任何外部工具，可离线运行。

## 文档

- [架构与流水线](docs/architecture.md)
- [安全模型与护栏](docs/safety-model.md)
- [注册表与新增 harness](docs/harness-registry.md)

## 许可

本项目基于 [Apache License 2.0](LICENSE) 发布，© outerarc-ai。

许可证包含明确的专利授权条款。分发或修改时请保留 `LICENSE` 文件；若上游提供了 `NOTICE` 文件，也请一并保留。

## 参与贡献

欢迎提交 Issue 与 PR。开始前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)；涉及「删错东西」的安全问题请按 [SECURITY.md](SECURITY.md) 私下上报，不要开公开 Issue。