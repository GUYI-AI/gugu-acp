# Claude ACP v2 build

Pinned upstream: `v0.94.0`, commit `7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1`.
This release serves protocol 2 only. The patches apply in lexical order; the build
runs the full upstream unit suite before stamping and packing version `2.0.0`.

| Patch | Purpose | Upstream disposition |
| --- | --- | --- |
| 0001 | Opt-in steering delivery `next` | Propose with the v2 steering request. |
| 0002 | Forward the SDK's `forkSession` | Existing Gugu behavior; retain until upstream matches it. |
| 0003 | Offer UltraCode effort | Retain until upstream exposes the same effort. |
| 0004 | Mark heuristic context windows | Candidate protocol metadata improvement. |
| 0005 | Preserve token-auth identity when CLI has no account identity | Candidate auth-status fix. |
| 0006 | Preserve streamed prefixes across repeated message starts | Independent upstream bug fix with regression tests. |
| 0007 | Preserve opt-in incremental MCP argument previews | Candidate opt-in rendering enhancement. |
| 0008 | Use v2 foreground completion, named steering/task control, and child associations | Split the behaviors below for upstream review. |

Patch 0008 removes the v1 wire router and its prompt-cancellation wrappers, the
`deferredSettle`/spawned-task hold, and obsolete tests of that lifecycle. Parent
results complete foreground work while the session consumer continues reading
child output, completion and permissions. Steering retains the SDK's exact send
UUIDs and `next` priority; task updates and stop use named extensions. Child
sessions always use standard v2 `subagent_update`, even for clients carrying AIR
extension markers. `delegationToolCallId` links the child to its actual launch
call. A permission from an identified subagent is never counted as an unfinished
parent tool merely because `task_started` arrives later.

The independently reviewable upstream candidates are foreground settlement,
late child permission ownership, v2 steering, named task control, and delegation
metadata. Rejecting v1 connections and deleting v1-only fixtures are Gugu release
policy; upstream can retain its own v1 support while adopting those improvements.
No upstream PR or issue is opened by this branch.

## Compatibility and rollout

The released v1 host reads only `compat.bridges["claude-agent-acp"]`; it ignores
new fields inside releases. That key remains unchanged and ends at `1.4.1`.
Protocol-2 releases live exclusively under `claude-agent-acp-v2`. The build and
compat automation use `bridge.compatKey` and refuse to append a protocol-2 release
to the legacy key. `scripts/compat-isolation.test.mjs` exercises the shipped v1
selector against the complete new table, including future CLI versions.

The new host reads the v2 key and requires a protocol-2 declaration. Missing
pairings and failed downloads are errors. There is no fallback to a v1 package,
a local development path, or an undeclared cached version.

Version `2.0.0` and the accompanying compat package must be published only after
owner approval. Until then, mac1 validation substitutes local `npm pack` tarballs
in an explicit build fixture. This branch never publishes as part of validation.
