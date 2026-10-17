# zcode-acp patches

`@gugu-acp/zcode-acp` = [william0wang/zcode-acp](https://github.com/william0wang/zcode-acp) at the tag in `bridge.json` + the patches below. The upstream bridge drives ZCode's own desktop protocol (`zcode app-server --stdio`); ZCode's CLI has no ACP of its own.

**These patches are not filed upstream** (owner, 2026-10-17: "上游补丁就算了，记录好我们自己改掉就行"). They live only here. So every upstream upgrade has to go through the checklist at the end, patch by patch: apply it again, or drop it because upstream now does the same.

Measurements behind each patch: gugu-base `notes/2026-10-16-zcode-harness/` (ZCode 3.15.3, CLI 0.16.9, upstream v0.72.0).

## 0001 `_session/steering` — a mid-turn message joins the running turn

- **What**: adds the ACP extension method `_session/steering`, with the same name and contract as claude-agent-acp's and pi-acp's 0001:
  - while a turn runs, it answers `injected`;
  - when idle, it answers `promptRequired` + `noRunningTurn` if the client asked for that through `_meta.steering.idleBehavior`;
  - otherwise it starts a new turn and answers `startedNewTurn`.
  
  The running case sends `v4/command sendText` with `requestedDelivery: "guide"`, which is the app-server's own steer path: the text joins the turn at its next tool boundary. `initialize` advertises `_meta.steering.supported = true`.
- **Why**: Gugu delivers group messages that arrive mid-turn this way. Without the patch, a second `session/prompt` preempts the first one. The first one then reports `cancelled` even though its work went on, so Gugu shows the turn as interrupted.
- **Upstream code**:
  - `src/index.ts` `buildAgentApp()`, where the ACP method routes are registered;
  - `src/server.ts` `initialize()`;
  - the preempting path in `src/handlers/session.ts` `prompt()` / `runPrompt` (the "preempt others" lock, around `pendingTurns`).
  - New file: `src/handlers/steering.ts` (+ `tests/steering.test.ts`).
- **Check on upgrade**: does upstream now register `_session/steering` itself, or translate `turn.steerQueued` / `turn.steerDrained` (marked "not yet translated" in `src/backend/types.ts`)? If it does, rerun ABC check C (a mid-turn message ends in one turn) without this patch before dropping it. Also check that `v4/command sendText` still accepts `requestedDelivery: "guide"`; the source of truth is ZCode's `packages/shared/src/zcode-protocol-v4/command.ts`.

## 0002 No `.zcode/acp/sandbox.json` in the user's workspace

- **What**: `readSandboxConfig()` reads a missing file as "not armed" and no longer writes the discovery template. A file the user creates behaves exactly as before, including failing closed when it is unreadable or tampered with.
- **Why**: the backend spawn path reads this config for every workspace, so every project a client opened ended up with a `.zcode/acp/` directory.
- **Upstream code**: `src/backend/sandbox.ts` `readSandboxConfig()` (the `ENOENT` branch, plus the `templateFailedRoots` set it used). The test changed is `tests/sandbox.test.ts` ("reads a missing config as not armed and writes nothing into the workspace").
- **Check on upgrade**: does upstream still create the template on read? Upstream issue william0wang/zcode-acp#332 asks for an opt-out. If upstream adds one, set it from Gugu and drop the patch.

## 0003 Writes into the ZCode App's `tasks-index.sqlite` are opt-in

- **What**: the six writers into the desktop App's `~/.zcode/v2/tasks-index.sqlite` now run only with `ZCODE_ACP_TASKS_INDEX_WRITES=1`. The six are upsert on `session/new`, title update, rename, soft delete, workspace delete, and tombstone revival. Reads are unchanged.
- **Why**: those writes put every bridge session into the user's own ZCode desktop task list, and renamed or deleted entries there. That means writing another app's database outside the ZCode protocol. **Product-visible**: sessions started from Gugu do not appear in the user's ZCode desktop task list. They stay in the ZCode CLI's own session store, and `zcode --resume <id>` still finds them.
- **Upstream code**: `src/tasks-index.ts`, the writers `upsertSessionTask`, `renameSessionTask`, `updateSessionTitle`, `softDeleteTask`, `softDeleteWorkspaceTasks` and `reviveTombstonesOnActivity`, plus the new `appIndexWritesEnabled()`. The callers are `src/handlers/session.ts` (`session/new`, the title listener) and the remote endpoints. Tests changed: `tests/tasks-index.test.ts` and `tests/tasks-index-workspaces.test.ts`, which turn writes on for the writer cases, and one new default-off case.
- **Check on upgrade**: look for a new writer, i.e. any new `withSqliteRetry` call that issues INSERT, UPDATE or DELETE. It must sit behind `appIndexWritesEnabled()` too.

## 0004 Installing ZCode desktop updates is opt-in

- **What**: `POST /settings/app-update/install` answers 403 unless `ZCODE_ACP_APP_UPDATE_INSTALL=1`. The read-only check, `GET /settings/app-update`, is unchanged.
- **Why**: through this route the bridge could download a ZCode desktop release and swap the user's App bundle. What gets installed on the machine is not the bridge's call. The route is only reachable through the opt-in remote hub, so this patch makes the rule explicit.
- **Upstream code**: `src/remote/settings-endpoint.ts` `handleAppUpdateInstall()`; the module itself is `src/settings/app-update.ts`, unchanged. Test: `tests/settings-api.test.ts` ("refuses every install unless …").
- **Check on upgrade**: look for any new caller of `startAppUpdate` / `downloadRelease` outside this route.

## 0005 Honour `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`

- **What**: `zcodePersonalProviderPath()` returns `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` when that variable is set. That is the backend's own variable for the personal provider table (ZCode `packages/provider-node` runtime-paths). The bridge's model menu and the spawned backend then read the same file. The version-keyed builtin path is still overridden, as before.
- **Why**: Gugu gives a platform session its own provider table (the Gugu model gateway) in a 0600 file that Gugu owns. Before the patch the bridge read a fixed `<ZCODE_HOME>/v2/provider_config.json` and overwrote the variable on spawn, so the only alternative would have been to isolate the user's whole `~/.zcode` (sessions, skills, logins).
- **Upstream code**: `src/utils.ts` `zcodePersonalProviderPath()`. Its users are `src/config/options.ts` (model menu), `src/backend/resolve.ts` `builtinProviderEnv()` (spawn env) and `src/settings/provider-config.ts`. Tests: `tests/personal-provider-path.test.ts`, plus the new case in `tests/resolve-provider-runtime.test.ts`; the existing "overrides an inherited ambient value" case now covers only the builtin path.
- **Check on upgrade**: are there new readers of the personal table that bypass `zcodePersonalProviderPath()`? Grep for `provider_config.json`.

## 0006 Ship the ACP server without the terminal UI

- **What**: removes the `zcode-acp-martty` dependency (the bridge's own terminal UI, used only by `zcode-acp tui`) and its lockfile entries. `zcode-acp tui` now fails with "the terminal UI … is not part of this build".
- **Why**: installing Martty pulls about 190 MB the ACP server never loads: @deepseek-ai/libreoffice-kit (146 MB wasm), sherpa-onnx (32 MB per platform), resvg, @openma/deepseek-harness-acp and more. Gugu ships this bridge inside its app and its server package and only runs the ACP server.
- **Upstream code**: `package.json` dependencies, `pnpm-lock.yaml`, and `src/tui.ts` `resolveMarttyJs()` / `runTui()`, which already resolves Martty lazily. Test: `tests/tui.test.ts` ("ships without the martty wrapper").
- **Check on upgrade**: does anything outside `src/tui.ts` import `zcode-acp-martty`, and are there new dependencies of that size?

## 0007 Accept the personal provider table as content

- **What**: when `ZCODE_PERSONAL_PROVIDER_CONFIG_CONTENT` is set, the bridge does the following at startup, in both `main()` and `runHeadless()`, before the server exists:
  - writes the content into a private 0600 file in a fresh 0700 temp directory;
  - points `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` at it (0005 makes both the menu and the backend read it);
  - drops the content variable from its own environment, so children never inherit it;
  - removes the directory on process exit.
  
  Content that is not JSON throws. A SIGKILLed bridge leaves the file behind.
- **Why**: Gugu hands an ACP adapter process its platform-model configuration as one environment variable carrying the whole document, the same carrier it uses for its other harnesses. The ZCode backend only reads a file.
- **Upstream code**: `src/index.ts` `main()` / `runHeadless()`, right after `installCrashGuards()`. New file `src/config/provider-table-content.ts` (+ `tests/provider-table-content.test.ts`).
- **Check on upgrade**: both entry points still run it before any provider read or backend spawn.

## 0008 `set_config_option(mode)` lands like `session/set_mode`

- **What**: switching mode through `session/set_config_option` (configId `mode`) now does what `session/set_mode` already did after the backend call:
  - folds the plan flag (`sessionPlanActive`), so the rebuilt options and the `current_mode_update` say `plan`;
  - records `lastMode` for the turn-completion reconciliation.
- **Why**: the ZCode runtime keeps `settings.mode` at the underlying mode when plan is set; plan is an execution-state flag. Without the fold, a client that switches to plan through the config option reads back the previous mode and treats its own switch as refused. Gugu does exactly that whenever a bridge advertises a `mode` config option. Measured on mac1 (gugu#7385 A/B): a Gugu session started in Plan failed with "Failed to apply configured permission mode 'plan'". A bare ACP client read `yolo` back after `set_config_option(mode=plan)`, while `build`, `edit` and `yolo` read back as set.
- **Upstream code**: `src/config/options.ts` `setConfigOption()` (the `mode` branch after the backend `session/setMode`) and `src/handlers/session.ts` `setConfigOptionHandler()`. The reference behaviour is `src/handlers/extensions.ts` `setMode()`. Test: `tests/set-config-option-plan.test.ts`; its fake backend leaves `settings.mode` alone on plan, like the real runtime.
- **Check on upgrade**: does upstream route `set_config_option(mode)` through `setMode()`, or fold the plan flag there itself? If so, drop the patch.

## Upgrade checklist

1. `node scripts/build.mjs zcode-acp --tag <new tag>`. A patch that no longer applies stops the build (exit 3).
2. For each patch, run its **Check on upgrade** item against the new tag. If upstream now does the same, drop the patch and say so in the commit.
3. Upstream's full suite must pass (it carries the patch tests).
4. Drive the packed tarball end to end with a bare ACP client against a current ZCode desktop CLI:
   - a plain turn;
   - a mid-turn `_session/steering` that ends in one turn;
   - an MCP tool call;
   - AskUserQuestion;
   - a workspace left without `.zcode/`.
   
   The ZCode CLI is not on npm, so `follow` / ABC cannot run this unattended (`pairing: false`).
5. Bump `version` in `bridge.json`, merge, then publish with `scripts/publish.mjs`.
