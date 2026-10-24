# dsh-plugin-herdr

> [English](README.md) | **简体中文**

![home](assets/home.gif)

[DeepSeek Harness (DSH)](https://github.com/deepseek-ai/dsh) 的 Herdr 控制面插件：在 DSH 会话中直接观察与驱动 [Herdr](https://herdr.dev)——面向 AI 编码代理的终端工作区管理器。

## 功能

- **控制面** — 通过 Herdr Unix-domain socket 提供 19 个 `herdr_*` 工具（snapshot、agents、panes、workspaces、layout、notifications）
- **会话级 UI** — Herdr Tab 与侧边面板仅展示当前会话的 workspace；非 Herdr 模式下自动隐藏
- **Herdr 模式** — 以 Herdr 模式创建会话，自动获得与会话同生命周期的专属 workspace

## 安装

前置条件：一个 DSH profile（如 `web`）和运行中的 Herdr server。插件通过本机 Herdr socket 通信；面板可按需从 `PATH` 拉起 server。

```sh
# npm（已发布为 dsh-plugin-herdr）
dsh plugin --profile web add dsh-plugin-herdr

# 本地目录
dsh plugin --profile web add /path/to/dsh-plugin-herdr

# tarball（pnpm pack 产物）
pnpm pack
dsh plugin --profile web add ./dsh-plugin-herdr-*.tgz

# git
dsh plugin --profile web add github:sunny0826/dsh-plugin-herdr
```

安装后重启 profile。用 `dsh plugin --profile web list` 验证。

## 卸载

```sh
dsh plugin --profile web remove dsh-plugin-herdr
```

重启 profile 即可卸载工具、面板与 Herdr 模式。预设副本残留在 `$DSH_HOME/.agent-presets/herdr/`，按需手动删除。

## 开发

```sh
pnpm install
pnpm build        # tsdown（node 入口 + web client bundle）
pnpm quality      # typecheck + gen-types 漂移检查 + 单测
pnpm test         # 单测（node --test）
pnpm test:integration  # 对接真实 herdr server；不可用时 SKIP
pnpm gen:types    # 从 herdr schema fixture 重新生成协议类型
```

### 个人分支的原生会话

`feat/bot-conversations` 在 `/herdr-bots/` 下增加 `upload`、`download`、
`approvals` 和 `answer` 鉴权接口，并为聊天和消息流增加可选群聊目标。
配合 DS Bot `feat/ovis-conversations` 和 Ovis `feat/native-conversations`
使用。附件每个最大 10 MiB；审批仅支持明确的“仅允许一次”和“拒绝”，不修改权限策略。
只读目录协议仍为版本 1；Ovis 不转发 DSH 浏览器 Cookie。
