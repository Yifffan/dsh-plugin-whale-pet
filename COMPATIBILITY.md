# Compatibility and verification boundaries

## Target environment

- Public source snapshot: **0.2.8-beta.1**.
- Compatibility target: **DSH Desktop 0.1.6-alpha.2**, originally developed on macOS arm64.
- Node.js 22+ for development, with the pnpm version declared in the project manifest.
- No claim of certification for other DSH versions or operating systems.

This is a personal, experimental plugin, not an official DeepSeek product.

## Known runtime issue

**Celebration may not appear after a normally completed reply in the installed app, including after restart.** Reports affect both current-session and global scope. The cause is not yet established. This public beta changes publication tooling/documentation; it does not claim to fix that runtime issue.

Both scopes consume the same Host/Remote boundary stream. A successful response must reach that stream, pass main-session/scope filtering, and survive waiting/error display priority. The current implementation does not infer success from a falling working count or DSH's green unread-completion indicator.

The green indicator is a background unread activity-stop hint, not a reliable normal-success reason; directly substituting it would change semantics and could celebrate cancellation or failure.

## Architecture and boundaries

- Root overlay slot: `shell.overlay`.
- Host React/ReactDOM and public UI icon references; no second React runtime or extracted DSH implementation is bundled.
- Root session catalog/status aggregates persistent work and waiting state.
- A plugin-owned read-only Host service projects live turn boundaries through the existing authenticated connection.
- No model calls, approval handling, external listening port, telemetry or runtime font/CDN downloads.
- Subagent activity is not counted as separate ordinary main sessions.
- Normal completion is eligible immediately; it does not wait for driver idle. Cancellation, history, reconnect baselines and falling running counts alone must not produce success.

## Tests versus real installation

The included Node suite uses project-local synthetic inputs and isolated components. It covers schemas, aggregation, ordering, cancellation, reconnects, lifecycle cleanup, localization, fonts, packaging contracts and migration planning.

The generated preview deliberately simulates states. It can show celebration artwork without proving that a real DSH completion event was delivered.

Development also used isolated browser and DSH protocol experiments. Their proprietary host fixtures and machine-specific tooling are not distributed here. Those experiments do not certify the current app's installed behavior.

Passing the portable suite, a clean build or a package download check is **not** a live DSH installation/upgrade test. Real-app verification is still needed for normal completion, cancel/error, restart/reconnect and upgrades.

## Entry-ID migration

Since 0.2.7:

```yaml
- insert:
    - id: whale-pet
      name: dsh-plugin-whale-pet
```

Older releases used the module name as the entry ID too. DSH matches user overrides by ID; an old override is skipped when no matching entry exists. This can lose an enabled/disabled setting even though it does not create a duplicate row.

Read [UPGRADE.md](UPGRADE.md) before upgrading from 0.2.6 or earlier. The package does not automatically modify any profile or global configuration.

## UI and assets

Native customizable selects and `corner-shape` rely on the target browser's support; an unrelated browser may render a preview differently. Production uses the host's theme tokens and icon. The offline preview uses an independently drawn generic chevron instead of an extracted icon fixture.

Whale artwork and embedded copies retain their separate permission terms. See [artwork permission](ASSETS-LICENSE.md), [code license](LICENSE) and [font licenses](FONT-LICENSES.md).
