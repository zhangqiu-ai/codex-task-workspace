# Hook collection skeleton

The adapter accepts SessionStart, Stop, and SessionEnd JSON on stdin (maximum 1 MiB). It writes only the normalized event ID, event name, session ID, optional working directory and timestamp to SQLite. It does not read transcript files or retain prompts, assistant output, credentials, or the raw payload. No Git command runs during collection.

Build before enabling the plugin. The command uses `node "${PLUGIN_ROOT}/dist/hooks.js"`; Node must be available in the host's PATH. `TASK_WORKSPACE_HOME` selects the data directory, otherwise Store uses `~/.local/share/codex-task-workspace`. Hook commands and MCP/UI must share that directory. The adapter emits no stdout and never blocks a turn intentionally; collection failures return exit 1 with a generic stderr message, never exit 2. A failure does not write a successful delivery or refresh success health. Failures before SQLite is opened cannot persist health and must be diagnosed through host hook errors; lack of events does not prove health.

## Evidence and integration boundary

Verified against the local Codex source snapshot under `/Users/feature/code/qiuge-helper/third_party/codex/codex-rs/hooks`:

- `src/schema.rs`, SessionStartCommandInput (line 486), StopCommandInput (575), and SessionEndCommandInput (502), define `hook_event_name`, `session_id`, and `cwd`. Stop also provides `turn_id`. These payloads do not promise `event_id` or timestamps. Extra payload fields are discarded.
- `src/engine/discovery.rs` (line 262) supplies `PLUGIN_ROOT` and `CLAUDE_PLUGIN_ROOT` to plugin commands. `CODEX_PLUGIN_ROOT` is not assumed.
- `src/events/session_end.rs` caps SessionEnd commands at three seconds; configuration uses that limit.
- `src/events/stop.rs` treats exit 2 as a request to continue the turn. This collector does not use that code or emit control JSON.

This is a source-checked collection skeleton, not evidence that the installed Codex desktop build has loaded or dispatched these hooks. Live host installation, discovery, and event delivery need a separate host smoke test. Successful synthetic stdin ingestion only verifies this adapter and storage.

Read-only host audit on 2026-09-13 found `codex-cli 0.153.4` with `plugin add/list/marketplace/remove` commands. The local source also resolves `${PLUGIN_ROOT}` in MCP arguments (`codex-rs/codex-mcp/src/agent_plugin_config.rs` and `plugin_config_tests.rs`). Neither observation proves this plugin is enabled in the running desktop task. No global installation or app modification was performed.

`tests/hooks.test.mjs` launches the built collector as a real subprocess for all three lifecycle events, checks persistence in an isolated data directory, and verifies private failure output. `tests/mcp.test.mjs` exercises the real stdio protocol. MCP shutdown closes both transport and SQLite on stdin EOF, SIGINT, or SIGTERM. These checks establish local process behavior, not host delivery. Before calling automatic collection ready, enable the built plugin through a supported host installation flow and observe a new host-created session ID in Hook Health/Inbox after a real turn.

## Delivery identity

An explicit `event_id` is preferred when a sender supplies it. Otherwise SHA-256 covers the event name, session, cwd, turn ID and supplied timestamp when a turn or timestamp exists. Different Stop turns therefore do not collapse even when the host omits timestamps. Replays with identical distinguishing metadata deduplicate. Without a turn ID or timestamp, each delivery gets a random UUID: SessionStart/SessionEnd retries cannot reliably be distinguished from new occurrences, so the collector preserves them instead of dropping real events. Multiple distinct deliveries within one turn need sender-provided event IDs or timestamps to distinguish them. No raw content is used to generate identity.
