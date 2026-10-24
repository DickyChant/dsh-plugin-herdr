#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
node=${DSH_RUNTIME_NODE:-node}
case "${1:-status}" in
  supervise)
    lock=$("$node" "$root/runtime.mjs" lock-path)
    # The kernel releases this lock even after a crash; never delete its inode.
    exec flock --no-fork --nonblock "$lock" "$node" "$root/runtime.mjs" serve
    ;;
  start|stop|ensure)
    lock=$("$node" "$root/runtime.mjs" action-lock-path)
    exec flock --no-fork --wait 25 "$lock" "$node" "$root/runtime.mjs" "$1"
    ;;
  *) exec "$node" "$root/runtime.mjs" "${1:-status}" ;;
esac
