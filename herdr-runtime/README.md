# DSH Web runtime for Herdr

A Linux/WSL companion to the DSH-side `dsh-plugin-herdr`. It keeps one DSH **Web** runtime in a Herdr-owned tab, optionally with an interactive TUI in that same process. It does not automatically resume a TUI conversation or replay Bot prompts.

Requires Herdr 0.9.4+, Node 22+, `flock` (util-linux), and an already configured `dsh web` profile. Node and DSH must be available on the Herdr server's PATH. No npm install/build is needed for this companion.

```sh
herdr plugin install DickyChant/dsh-plugin-herdr/herdr-runtime --ref feat/herdr-dsh-runtime
# Or, for a local checkout:
herdr plugin link /absolute/path/to/dsh-plugin-herdr/herdr-runtime

herdr plugin action invoke start --plugin dickychant.dsh-runtime
herdr plugin action invoke status --plugin dickychant.dsh-runtime
herdr plugin action invoke logs --plugin dickychant.dsh-runtime
herdr plugin action invoke stop --plugin dickychant.dsh-runtime
```

The same four actions appear in Herdr's plugin actions. Action invocations are asynchronous; inspect their result with `herdr plugin log list --plugin dickychant.dsh-runtime`. For synchronous output from this checkout, run `sh herdr-runtime/launch.sh status` or `logs`.

Start opts into automatic recovery. The first install does not start DSH. Closing a browser/client leaves the service running. A DSH process exit triggers retries with exponential backoff, capped at 30 seconds. A Herdr shutdown stops the owned DSH process; on the next Herdr server start, the startup hook restores the service. Herdr itself must be started after a machine reboot. Stop persists across Herdr restarts until Start is requested again.

A kernel lock permits only one supervisor for the DSH home, even across Herdr sessions. An existing listener on the configured port is reported as external and is never killed or adopted. Stop affects only the child owned by this supervisor. Do not run a second Web profile against the same DSH home on another port while this service is active.

Restoring uses a recorded, uniquely labelled service tab. The hook replaces only a matching dormant restored shell; renamed or repurposed panes are left alone. Start preserves the focused pane. Closing the service tab ends its supervisor; use Start to bring it back. Recovery after a supervisor itself is killed requires Start or a Herdr restart. No systemd/OS startup service is installed.

## Configuration

`herdr plugin config-dir dickychant.dsh-runtime` prints the directory. Optional `runtime.json`:

```json
{
  "command": ["/absolute/path/to/dsh"],
  "home": "/home/you/.dsh",
  "cwd": "/home/you",
  "port": 3080,
  "env": {
    "HERDR_DSH_TOKEN_FILE": "/home/you/.config/ovis-dsh/bridge-token"
  }
}
```

`command` is an argv array, never a shell expression. Defaults are `dsh`, `$DSH_HOME` or `~/.dsh`, the user's home directory and port 3080. The runtime always binds to `127.0.0.1`, runs the selected profile (default `web`) with `--no-open`, and uses the existing profile/plugins. Configuration is trusted local code configuration: `command` and `env` can launch/configure arbitrary programs. Stop before changing home/port/command, then Start. The plugin does not install DSH or modify its model, approval or conversation settings.

### TUI and Web together

Prepare a separate DSH profile containing the Web bundle, the existing Bot/Herdr
plugins and `@deepseek-harness-tui/dsh-tui`. Preserve the working profile's package
manager settings (`nodeLinker: hoisted`, `autoInstallPeers: false`) so registry
peers do not shadow the installed DSH core. Retain its Web authentication and CSP
configuration. On DSH 0.2.1-rc.2, disable the `experimental-inspector` and
`session-inspector` rows in the combined profile: the experimental inspector
can crash during combined startup. Then set these additional fields in `runtime.json`:

```json
{
  "profile": "web-tui",
  "interactive": true
}
```

`profile` defaults to `web`; `interactive` defaults to `false`. Interactive mode
requires a real terminal and passes the pane's input/output directly to DSH.
Resizes reach the child, and terminal settings are restored after exit or a
crash. Lifecycle logs remain private and do not overwrite the TUI. Raw terminal
output is visible in the pane and is not copied into `dsh.log` in this mode.

Web and the TUI share one process. Leaving the Herdr client or browser does not
stop it. Quitting the TUI stops that process and the supervisor restarts it using
the usual backoff; use the Stop action to keep it stopped. Ovis continues using
the same Web bridge and port. The TUI's conversation is not automatically the
Chief Bot conversation; use Ovis's Bot workspace to talk to Chief.

State is private under `$DSH_HOME/.herdr-runtime/web` (directory 0700). `events.log` contains only lifecycle events and is what Logs displays. `dsh.log` contains raw DSH output, including its browser login URL, and is **private (0600)**. Do not publish it. Logs rotate at 256 KiB/2 MiB respectively, retaining one previous file. Ovis's native `/dsh` workspace keeps using its existing authenticated bridge on port 3080; no browser cookies are shared or bypassed.

## Verification

```sh
node --test herdr-runtime/test/runtime.test.mjs
node herdr-runtime/test/herdr.integration.mjs
```

The integration test starts/stops only a temporary isolated Herdr server with a fake DSH and fresh configuration. It checks recovery, Stop persistence, duplicate protection, focus preservation and no accumulating service tabs. It never uses the real DSH profile.
