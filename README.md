# dsh-plugin-herdr

> **English** | [简体中文](README.zh-CN.md)

![home](assets/demo.gif)

Herdr control-plane plugin for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness): observe and drive [Herdr](https://herdr.dev) — a terminal workspace manager for AI coding agents — directly from DSH sessions.

## Features

- **Control plane** — 19 `herdr_*` tools over Herdr's Unix-domain socket (snapshot, agents, panes, workspaces, layout, notifications)
- **Session-scoped UI** — Herdr tab and side panel show only the current session's workspace; hidden outside Herdr mode
- **Herdr mode** — create a session in Herdr mode to get a dedicated workspace that lives and dies with the session

## Install

Prerequisites: a DSH profile (e.g. `web`) and a running Herdr server. The plugin talks to the local Herdr socket; the panel can start the server from `PATH` if needed.

```sh
# npm (published as dsh-plugin-herdr)
dsh plugin --profile web add dsh-plugin-herdr

# local directory
dsh plugin --profile web add /path/to/dsh-plugin-herdr

# tarball (pnpm pack output)
pnpm pack
dsh plugin --profile web add ./dsh-plugin-herdr-*.tgz

# git
dsh plugin --profile web add github:sunny0826/dsh-plugin-herdr
```

Restart the profile after install. Verify with `dsh plugin --profile web list`.

## Keep DSH Web running in Herdr

The optional [Herdr runtime companion](herdr-runtime/README.md) adds Start, Stop, Status and Logs actions, a background service tab, crash retries and startup recovery. It is separate from the DSH-side plugin above and currently supports Linux/WSL. Development lives in the personal fork; no upstream PR is required to install it.

```sh
herdr plugin install DickyChant/dsh-plugin-herdr/herdr-runtime --ref feat/herdr-dsh-runtime
herdr plugin action invoke start --plugin dickychant.dsh-runtime
```

An intentional Stop persists across restarts. Recovery begins when Herdr starts; this does not install a machine startup service or automatically continue a Bot conversation.

## Uninstall

```sh
dsh plugin --profile web remove dsh-plugin-herdr
```

Restart the profile to unload tools, panel, and Herdr mode. The preset copy at `$DSH_HOME/.agent-presets/herdr/` is left behind — remove it manually if needed.

## Development

```sh
pnpm install
pnpm build        # tsdown (node entries + web client bundle)
pnpm quality      # typecheck + gen-types drift check + unit tests
pnpm test         # unit tests (node --test)
pnpm test:integration  # against a live herdr server; SKIPs when unavailable
pnpm gen:types    # regenerate protocol types from the herdr schema fixture
```

### Optional DS Bot directory (personal fork)

`GET /herdr-bots` exposes versioned, read-only metadata when DS Bot provides the
`botDirectory` service. It uses the existing localhost Host/Origin guard and accepts
only GET. Without the service it returns 503; Herdr tools continue to work. Responses
are `no-store` and contain no conversation text, tool arguments, credentials or approval
contents. The `DickyChant/DeepSeek-Bot` branch `feat/ovis-directory` supplies the service;
the `DickyChant/ovis` branch `feat/dsh-bots` consumes it from the Ovis server.

当 DS Bot 提供 `botDirectory` 服务时，`GET /herdr-bots` 返回版本化的只读元数据。
该接口沿用本地 Host/Origin 检查，只接受 GET；没有服务时返回 503，不影响 Herdr 工具。
响应禁止缓存，不包含对话正文、工具参数、凭据或审批内容。


### Optional direct chat bridge (personal fork)

The `feat/bot-chat` branch adds `/herdr-bots/chat` and `/herdr-bots/send` (POST),
and `/herdr-bots/events` (GET/SSE). They require both the local Host/Origin guard
and a private Bearer credential. Store a random 32-byte hex credential with mode
0600 at `~/.config/ovis-dsh/bridge-token`, or set `HERDR_DSH_TOKEN_FILE` to its path.
Ovis reads the same private file on the server; the browser never receives it.
Without a credential the routes refuse access, while the directory still works.

DS Bot's `botBridge` service is required (`DickyChant/DeepSeek-Bot`, `feat/ovis-chat`).
The service resolves persistent runtime/Bot IDs into the current own chat, queues
text messages through DSH and provides filtered live events. Ovis reloads history
on reconnect. Approval controls and group chat remain in DSH. Automatic send retries
are disabled; request IDs deduplicate repeated submissions within a bounded runtime cache.

`feat/bot-chat` 分支新增私聊记录、消息发送与实时事件接口。这些接口同时要求本地
Host/Origin 校验和私有 Bearer 凭据。将随机生成的 32 字节十六进制凭据保存为
`~/.config/ovis-dsh/bridge-token`（权限 0600），或通过 `HERDR_DSH_TOKEN_FILE`
指定文件路径。Ovis 服务端读取同一文件，浏览器不会收到凭据。没有凭据时私聊接口
拒绝访问，目录接口仍可使用。审批和群聊保留在 DSH 中；断线后重新读取记录，不自动重发消息。

### Native conversations in the personal fork

`feat/bot-conversations` adds authenticated POST routes for `upload`, `download`,
`approvals`, and `answer` under `/herdr-bots/`, plus optional room targeting on chat,
send and events. It requires DS Bot's `feat/ovis-conversations` bridge and Ovis's
`feat/native-conversations` UI. Uploads are capped at 10 MiB per file. Approval
answers are limited to explicit allow-once or reject decisions; policy is unchanged.
The metadata-only directory remains version 1. No DSH browser cookie is forwarded.

个人分支 `feat/bot-conversations` 增加群聊目标、附件上传和下载，以及待审批查询和
明确的一次性审批决定。配合 DS Bot 的 `feat/ovis-conversations` 与 Ovis 的
`feat/native-conversations` 使用。每个附件最大 10 MiB，审批不修改权限策略。
只读目录仍为版本 1，接口不转发 DSH 浏览器 Cookie。
