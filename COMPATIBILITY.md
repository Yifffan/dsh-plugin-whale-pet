# Compatibility and verification boundaries

## Release and target environment

- Release: **0.2.8**, without a prerelease suffix.
- Original compatibility target: **DSH Desktop 0.1.6-alpha.2 on macOS arm64**.
- Development requires Node.js 22+ and the pnpm version declared in the project manifest.
- This is a personal plugin, not an official DeepSeek product. A formal package release is not universal certification for every DSH version or operating system.

## Completion synchronization fix

Earlier builds registered the custom Remote methods but accessed `remote.whalePet` from a context that declared only the general `remote` dependency. Real Cordis rejected that namespace access before the request reached the Host.

The implementation now acquires a lifecycle-owned child context declaring `remote.whalePet` **after** registration, then invokes the namespace through that context. This avoids both undeclared access and a startup dependency cycle. Failed local registration can retry; overlapping mount cleanup, namespace readiness, withdrawal, reconnect and cancellation have regression coverage.

The user confirmed that normal-reply celebration appeared in the installed app using the corrected beta.3. Release 0.2.8 retains that fix and removes the temporary diagnostic UI, collector, counters and diagnostic RPC. No claim is made that every edge case was live-tested.

## Architecture and behavior

- Root overlay slot: `shell.overlay`.
- Host React/ReactDOM and public UI icon references; no second React runtime or extracted DSH implementation is bundled.
- Root session catalog/status supplies work and waiting state independently of completion delivery.
- A plugin-owned read-only Host service projects live turn boundaries through the existing authenticated connection.
- No model calls, approval handling, external listening port, telemetry or runtime font/CDN downloads.
- Subagent activity is not counted as separate ordinary main sessions.
- Normal completion is eligible immediately; it does not wait for driver idle. Waiting and errors retain their display priority.
- Cancellation, history, reconnect baselines and falling running counts alone do not produce success. DSH's green unread indicator is not substituted for a normal completion reason.
- Brief notices are bounded and not replayed from disconnected history. Intermediate assistant/tool messages do not necessarily mark the end of a turn.

## Tests versus installation

The portable Node suite uses synthetic data and isolated components. It covers strict contracts, scope/capability access, aggregation, ordering, cancellation, reconnects, lifecycle cleanup, localization, fonts, packaging and migration planning. Its namespace fixture rejects undeclared access instead of exposing a permissive plain-object Remote.

Separate isolation experiments exercised actual installed Cordis, the Typert registry and Gateway with an in-memory carrier, including completion delivery into the pet state machine. The inspected installed Gateway package reported **0.1.7-alpha.1**; that identifies an SDK module used in the experiment, not an asserted version of every running GUI component. Archived alpha.2 contracts were also checked. Proprietary host fixtures are not distributed in this repository.

The offline browser preview simulates state. Browser checks establish menu/rendering behavior, not delivery of real Host events. The real-app normal-completion confirmation does not replace further validation of concurrent sessions, reconnects, cancel/error or upgrades on other systems.

## Entry-ID migration

Since 0.2.7:

```yaml
- insert:
    - id: whale-pet
      name: dsh-plugin-whale-pet
```

Older releases used the module name as the entry ID too. DSH matches user overrides by ID; an old override is skipped when no matching entry exists. Read the [upgrade notes](UPGRADE.md) before upgrading from 0.2.6 or earlier. No automatic profile migration runs on install.

## UI and assets

Native customizable selects and `corner-shape` rely on the target browser's support. Production uses the host's theme tokens and icon; the offline preview uses an independently drawn generic chevron.

Whale artwork and embedded copies retain their separate permission terms. See [artwork permission](ASSETS-LICENSE.md), [code license](LICENSE) and [font licenses](FONT-LICENSES.md).
