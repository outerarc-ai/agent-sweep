# 注册表与新增 harness

agent-sweep 的核心设计是**声明与引擎分离**：扫描、判定、执行逻辑与具体 harness 无关；每个 harness 只是一份纯数据声明。新增一个 harness = 新增一个文件 + 在 `index.js` 注册。

## 目录

```
src/core/harnesses/
├── index.js        # 汇总导出 ALL_HARNESSES
├── claude-code.js
├── codex.js
├── cursor.js
├── windsurf.js
├── trae.js
├── copilot.js
├── aider.js
└── goose.js
```

## 声明结构

```js
export const myHarness = {
  id: 'my-harness',            // 必填，唯一，小写连字符
  name: 'My Harness',          // 必填，展示名
  aliases: ['myh'],            // 可选，命令行可用别名
  vendor: 'Vendor',            // 可选
  kind: 'cli',                 // cli | ide | xdg
  platforms: ['darwin', 'linux', 'win32'],   // 必填，非空
  defaultTTL: 30,              // 必填，正数（天）
  risk: 'medium',              // 必填，low | medium | high
  deleteEnabled: true,         // 是否允许产生可执行动作
  docs: 'https://…',           // 可选，官方文档
  summary: '一句话说明残留来源与治理边界。',
  targets: [ /* 见下 */ ],
  neverDelete: ['~/.my-harness/memory/**'],  // 可选，追加护栏
  notes: ['补充说明'],
};
```

### 校验规则

`loadRegistry()` 会对每份声明做完整校验，任一项不满足即抛 `RegistryError` 并列出**全部**问题：

- `id` / `name` 非空，`id` 全局唯一，别名不得冲突
- `platforms` 非空数组；`defaultTTL` 为正数；`risk` ∈ {low, medium, high}
- `targets` 非空数组，`target.id` 在 harness 内唯一
- `target.unit` ∈ {`child-dir`, `child-entry`, `nested-dir`, `glob-file`, `dir`}
- `target.paths` 非空数组；`target.removable` 为布尔；`target.kind` 非空字符串
- `nested-dir` 必须带 `depth >= 2`；`glob-file` 必须带 `pattern`

## target（扫描目标）

```js
{
  id: 'worktrees',                 // 必填，harness 内唯一
  kind: 'worktree',                // 必填，语义类别，参与圈层判定
  label: '工作树 (~/.trae-cn/worktrees/<project>/<branch>)',
  paths: ['~/.trae-cn/worktrees', '~/.trae/worktrees'],   // 必填，支持 token
  unit: 'nested-dir',              // 必填，候选单元粒度
  depth: 2,                        // nested-dir 必填
  pattern: '**/rollout-*.jsonl',   // glob-file 必填
  ageBasis: 'leaf-max-mtime',      // 文档性字段
  orphan: { type: 'git-worktree' },// 可选，默认 none
  removable: true,                 // 必填：false = 仅报告
  lockFiles: ['lock'],             // 可选，活跃判定用
  notes: '…',
}
```

### unit 模式

| 模式 | 候选单元 | 适用 |
| --- | --- | --- |
| `child-dir` | 根目录下的每个直接子目录 | 会话目录、缓存目录 |
| `child-entry` | 根目录下的每个直接子项（文件或目录） | 扁平缓存目录 |
| `nested-dir` | 根目录下「子目录的子目录」 | `<root>/<project>/<branch>` 布局的 worktree |
| `glob-file` | 根目录下匹配 `pattern` 的每个文件 | 按天分层的 rollout、备份文件 |
| `dir` | 根目录自身作为单一单元 | 单目录整体回收 |

### orphan 类型

| 类型 | 判定 |
| --- | --- |
| `none` | 不做孤儿判定 |
| `git-worktree` | 读取单元内 `.git` 指针 → 推断主仓库 → 主仓库或 gitdir 缺失即为孤儿 |
| `encoded-cwd` | 单元目录名是宿主路径的编码（`/` → `-`）→ 逐段回探文件系统 → 无法还原即为孤儿 |

### kind 与圈层

`kind` 决定陈旧对象落入第 1 圈还是第 2 圈：

- **第 1 圈**（`SAFE_KINDS`）：`cache`、`log`、`index`、`thumbnail`
- 其余 kind（如 `session-store`、`worktree`、`attachment`、`app-cache`）在陈旧时按风险等级分流；`worktree` 若是孤儿则直接进第 1 圈

## 路径 token

`paths` 中可使用以下 token，运行时展开：

| token | 解析为 |
| --- | --- |
| `~` | 用户主目录（受 `AGENT_SWEEP_HOME_DIR` 影响） |
| `{appSupport}` | macOS: `~/Library/Application Support`；Windows: `%APPDATA%`；其他: `$XDG_CONFIG_HOME` 或 `~/.config` |
| `{config}` | `$XDG_CONFIG_HOME` 或 `~/.config` |
| `{data}` | `$XDG_DATA_HOME` 或 `~/.local/share` |
| `{state}` | `$XDG_STATE_HOME` 或 `~/.local/state` |
| `{cache}` | macOS: `~/Library/Caches`；其他: `$XDG_CACHE_HOME` 或 `~/.cache` |
| `{temp}` | `$TMPDIR` 或 `/tmp` |

## 完整示例：新增一个 harness

假设要为 `~/.mytool` 增加清理支持，它的会话数据在 `~/.mytool/sessions/<id>/`，还有一个 `<appSupport>/MyTool/Cache`：

```js
// src/core/harnesses/mytool.js
export const myTool = {
  id: 'mytool',
  name: 'My Tool',
  aliases: ['my-tool'],
  vendor: 'Acme',
  kind: 'cli',
  platforms: ['darwin', 'linux', 'win32'],
  defaultTTL: 30,
  risk: 'medium',
  deleteEnabled: false, // 首批先只报告，观察一版后再开启
  docs: 'https://example.com/mytool',
  summary: '会话目录按 id 分层；缓存目录为 Electron 常规缓存。',
  targets: [
    {
      id: 'sessions',
      kind: 'session-store',
      label: '会话目录 (~/.mytool/sessions/<id>)',
      paths: ['~/.mytool/sessions'],
      unit: 'child-dir',
      ageBasis: 'leaf-max-mtime',
      orphan: { type: 'none' },
      removable: false, // 仅报告
    },
    {
      id: 'app-cache',
      kind: 'cache',
      label: '应用缓存 ({appSupport}/MyTool/Cache)',
      paths: ['{appSupport}/MyTool/Cache'],
      unit: 'child-entry',
      ageBasis: 'leaf-max-mtime',
      orphan: { type: 'none' },
      removable: false,
    },
  ],
  neverDelete: ['~/.mytool/config.json', '~/.mytool/auth/**'],
  notes: ['auth/ 为登录凭据，永不清理。'],
};
```

然后在 `index.js` 中注册：

```js
import { myTool } from './mytool.js';

export const ALL_HARNESSES = [
  claudeCode, codexCli, cursor, windsurf, trae, copilot, aider, goose, myTool,
];

export { /* …, */ myTool };
```

完成。运行以下命令确认：

```bash
agent-sweep harnesses mytool --verbose   # 查看目标与护栏
agent-sweep doctor                        # 确认扫描根命中
agent-sweep scan --harness mytool --json  # 查看实际枚举结果
npm run check                             # 端到端自检仍然通过
```

## 建议的推进路径

1. **只报告**：`deleteEnabled: false` + `removable: false`，先让用户看到规模与分布。
2. **验证路径**：用 `harnesses --verbose` 与 `doctor` 确认目录约定与真实布局一致。
3. **开启安全子集**：把明确无争议的对象（缓存 / 日志 / 孤儿 worktree）设为 `removable: true`，并开启 `deleteEnabled`。
4. **保持保守**：含用户产物的会话目录（如 `work/`）默认留在第 2 圈，靠 `--include-review` 显式放行。