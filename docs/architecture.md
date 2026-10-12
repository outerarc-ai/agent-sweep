# 架构与流水线

agent-sweep 是一条**单向只读流水线**，写入被严格限制在最后一段。前四段保证「看」与「改」彻底分离。

```
注册表          扫描器          判定器          计划器          执行器          报告器
registry   →   scanner   →   analyzer   →   planner   →   executor   →   reporter
 (声明)        (枚举/测量)     (评分/圈层)     (可审阅清单)    (移入回收站)     (终端/JSON/HTML)
  只读            只读            只读            只读            ✍️ 写盘          只读
```

## 目录结构

```
agent-sweep/
├── bin/
│   └── agent-sweep.js        # 可执行入口，仅负责调用 main() 与设置退出码
├── src/
│   ├── cli/
│   │   ├── index.js          # 命令分发
│   │   ├── args.js           # 参数解析（含 --ttl/--min-size 等语义解析）
│   │   ├── context.js        # 组装注册表/护栏/策略/回收站，供命令复用
│   │   ├── help.js           # 用法文本与版本
│   │   ├── prompt.js         # 交互确认（非 TTY 时拒绝）
│   │   └── commands/         # scan / plan / clean / restore / trash / harnesses / doctor
│   ├── core/
│   │   ├── registry.js       # 注册表加载、校验、别名解析、目标路径展开
│   │   ├── harnesses/        # 8 份 harness 声明（每文件一个）
│   │   ├── scanner.js        # 枚举候选单元 + 测量 + 孤儿/活跃/保护判定
│   │   ├── analyzer.js       # 年龄推导、评分、圈层分类、汇总
│   │   ├── planner.js        # 选取动作、生成可序列化计划、汇总待 prune 主仓库
│   │   ├── executor.js       # 计划复检、移动/删除、worktree prune、执行报告
│   │   ├── trash.js          # 回收站批次、清单、还原、清空
│   │   └── reporter/         # terminal.js / json.js / html.js
│   ├── safety/
│   │   └── guards.js         # 全局 + 声明式护栏，目录级保护判定
│   └── lib/
│       ├── paths.js          # ~ / {token} 展开、路径包含判断
│       ├── platform.js       # 平台判定与 homedir（支持重定向）
│       ├── fsx.js            # 安全 lstat / 目录列举 / 子树测量 / 移动
│       ├── matcher.js        # glob → 正则（含 **、{a,b}），带缓存
│       ├── process.js        # lsof/tasklist 打开文件采集、活跃判定
│       ├── gitworktree.js    # .git 指针解析、主仓库推断、worktree prune
│       ├── strategy.js       # 权重、评分、圈层分类的单一事实来源
│       ├── format.js         # 字节/年龄/宽字符表格渲染
│       ├── async.js          # 有界并发 map
│       └── log.js            # 日志（彩色 / JSON / 静默）
├── scripts/
│   ├── lint.js               # 零依赖静态检查
│   └── selfcheck.js          # 端到端自检（合成 fixture）
└── test/                     # Node 内置测试运行器用例
```

## 各段职责

### 1. 注册表（registry）

加载并校验 8 份 harness 声明，解析 id / 别名，展开目标路径中的 `~` 与 `{appSupport}` `{config}` `{data}` `{state}` `{cache}` 等 token。校验失败会抛出 `RegistryError` 并列出全部问题，而不是静默跳过。

### 2. 扫描器（scanner）

对每个目标的每个根路径：

1. 按 `unit` 模式枚举候选单元（`child-dir` / `child-entry` / `nested-dir` / `glob-file` / `dir`）
2. 对每个单元测量子树（体积、文件数、**叶子最大 mtime**、符号链接数、是否截断）
3. 判定孤儿（`git-worktree` 或 `encoded-cwd`）
4. 判定活跃（lsof 打开文件 / lock 文件 PID）
5. 判定是否受保护（`safety/guards.js`）

枚举与测量使用有界并发（`--concurrency`，默认 8），并对文件遍历设上限以避免极端目录导致卡死。

### 3. 判定器（analyzer）

推导年龄（优先叶子 mtime，回退目录 mtime），调用 `strategy.js` 计算评分并分类圈层，最后按圈层与 harness 汇总。`summarize()` 产出终端与 HTML 报告所需的全部结构。

### 4. 计划器（planner）

从已分析单元中按圈层 / 最小评分 / harness 过滤出动作，生成带 schema 版本（`agent-sweep/plan@1`）的可序列化计划，并汇总「删除后需要 prune 的主仓库」。

### 5. 执行器（executor）

- **复检**：每个动作在执行前重新校验存在性、护栏与进程占用——计划生成到执行之间可能已发生变化。
- **移动**：默认 `rename` 到回收站；跨卷退化为复制后删除。
- **直接删除**：仅在 `--direct-delete --yes` 下可用。
- **连带动作**：对删除过的 worktree 的主仓库执行 `git worktree prune`。
- **预演**：`--dry-run` 走完复检并返回动作清单，但不写盘。

### 6. 报告器（reporter）

- **终端**：宽字符对齐的表格（中文按双宽计算），带圈层着色。
- **JSON**：`agent-sweep/report@1`，供下游工具消费。
- **HTML**：单文件自包含，内联 CSS、无脚本、无外部资源；所有动态内容经 HTML 转义。

## 数据流不变量

- 前四段**绝不**调用任何写盘 API（唯一例外：`--html` 写报告文件，属用户显式请求）。
- 圈层分类是纯函数：给定单元与策略，结果确定可复现。
- 计划与执行报告都带 schema 版本号，便于长期兼容。
- 执行前复检使「计划」与「现实」解耦——过期的计划不会误删。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `AGENT_SWEEP_HOME_DIR` | 覆盖 `homedir()`（测试与自检用） |
| `AGENT_SWEEP_HOME` | 覆盖回收站与状态根目录（默认 `~/.agent-sweep`） |
| `XDG_CONFIG_HOME` / `XDG_DATA_HOME` / `XDG_STATE_HOME` / `XDG_CACHE_HOME` | XDG 系 harness 的路径基准 |
| `NO_COLOR` / `FORCE_COLOR` | 颜色输出控制 |