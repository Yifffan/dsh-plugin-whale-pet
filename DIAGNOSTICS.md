# Completion synchronization diagnostics — local beta.2

This build is `0.2.8-beta.2`, a **local diagnostic prerelease**, not an npm release. It fixes a reproduced local Remote-registration retry defect and adds inspection tools. It does **not** establish that the installed missing-celebration issue is solved.

## 中文：如何提供诊断

1. 等当前任务结束，再在 DSH 插件安装入口安装提供的 `dsh-plugin-whale-pet-0.2.8-beta.2.tgz` 本地包。不要卸载旧版或手工改配置。条目 ID 仍为 `whale-pet`。
2. 安装后，如需重新加载 Host 模块，完整退出并重新打开 DSH；先保存工作并确认没有运行任务。插件不会自行重启、刷新或修改你的 profile。
3. **右键小鲸鱼 → 同步诊断**。先看 JSON 顶部版本是否为 `0.2.8-beta.2`，点击“复制诊断”保留一份回复前记录。复制失败时，文本会被选中，可按 **⌘C / Ctrl+C**。
4. 正常发一条消息，等助手完整回复结束；无需使用秘密信息、特殊测试提示词或额外调用模型的诊断工具。
5. 再打开“同步诊断”并复制回复后的记录，同时说明是否看到庆祝。把前后两份记录发回来即可；若只方便提供一份，先提供回复后的记录。

提问时问号正常、工作姿态正常，与完成事件通道是否正常是两回事。本版保留原来的工作、等待和结束原因判断。

## English: capture a useful comparison

- Install the provided local tgz after existing tasks finish. Reload the Host/client only when safe; the plugin never installs, restarts, or edits profiles itself.
- Right-click the whale, open **Sync diagnostics**, and use **Copy diagnostics**. Check the top-level version before proceeding.
- Keep one snapshot before a normal reply, then copy another after the reply finishes. Report whether celebration appeared.
- If clipboard access is unavailable, the read-only report is selected for manual **Ctrl/Cmd+C**.
- Refresh and Copy update the snapshot. The textarea is deliberately not rewritten by paint ticks, so manual selection is preserved.

## What the report means

- `counts.mountAttempts` / `mountFailures`: local registration of the typed client methods, **not** a Host availability check.
- `counts.watchAttempts`, `baselines`, `starts`, `ends`, `completed`: progress along the completion stream. A baseline alone is not proof that live boundaries arrive.
- `host`: a separate **user-requested, read-only** query over the existing authenticated connection. An unavailable or timed-out query is explicitly marked unavailable; it is not reported as zero events.
- Host counts cover accepted start/end boundaries since the Host service started, including admitted subagents. Client counts cover frames received since this widget instance started. **Do not compare absolute Host and client totals as if their lifetimes match.** Compare changes between captures and the bounded trace.
- `decisions`: categorized acceptance, filtering or deferral, including scope, subagent, unobserved activity, terminal reason, and error priority. Several decisions can describe one boundary; these are not message totals.
- `aggregate` and `view`: normalized running/waiting/notice state and the rendered pose. This helps distinguish transport loss from filtering or display priority.
- The ordered `trace` contains at most 64 recent metadata entries and relative elapsed times. It is diagnostic evidence, not a transcript or a replay queue.

## Privacy and side effects

Reports are held only in this widget's memory until you explicitly copy them. They contain allowlisted labels, booleans, bounded counts, version information and relative timing. They do **not** include chat text, session/agent IDs, session titles, credentials, full exceptions, stack traces or absolute timestamps. Unknown strings are not echoed.

Opening/refreshing/copying diagnostics can make one bounded read-only request for this plugin's Host counters. There is no continuous diagnostics polling, new HTTP route, new server, model call, analytics upload or automatic clipboard write. Closing or refreshing the app clears client-side diagnostic history.

## Limits

- The existing no-history-replay, overflow reset, main-session filtering and success/error classification policies remain in place. Cancellation, blocking and token limits are not converted to successful celebrations.
- The known retry correction matters only if local registration actually failed; it must not be generalized to every transport failure.
- Isolation tests and the offline menu preview do not prove that the actual running Host is supplying completion events. The requested before/after captures are the next evidence needed.
- If the report shows beta.1 or the menu lacks Sync diagnostics, the loaded client is not this build. If the client is beta.2 but Host diagnostics is unavailable, preserve that result rather than assuming zero Host activity.
