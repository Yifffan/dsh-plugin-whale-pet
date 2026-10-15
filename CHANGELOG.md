# Changelog

## 0.3.0 — 2026-10-15

### Added

- A school of fish swims past every so often. A whale that is working puts the laptop down, turns, swims after the school across the window, eats the straggler and returns to the spot it left. Five localized lines cover the beats: notice, tempted, chase, chomp, back to work.
- **Chase passing fish**, a third switch in the settings menu, turns the gag off on its own without touching the rest of the pet.
- Three school shapes are drawn per visit, so consecutive visits do not look identical.
- `assets/fish.svg`, an original fish drawn for this project and licensed like the code.

### Behavior notes

- The whale is displaced by CSS transforms only. `left`/`top` and the stored position preference never change, so it always comes back to the pixel the user chose, and starting a drag cancels the gag immediately.
- A genuine `waiting`, `celebrate` or `error` state always wins: fish never hide a pending decision, a failure or a win. Clicking or dragging the whale, hiding it, turning off **Gentle animations** or a host that asks for reduced motion also ends it at once.
- Reduced motion is honored twice over: the director refuses to schedule a school, and the existing media query freezes the timeline.
- No new network access, model calls or collected data. The gag is a local CSS timeline driven by wall-clock time and one random draw, and it is never persisted.

### Verification

- 200 portable checks pass, including a dedicated `tests/temptation.test.mjs` that pins the schedule, the quiet gap and every interruption, and asserts that the CSS timeline and the director agree.
- The offline browser check drives the real timeline: the school appears, the whale's box moves more than 200 px while `position.x` stays exactly where it was, the straggler lands within 30 px of the whale's mouth and disappears, a pending decision clears the gag, and a reduced-motion host gets no fish at all.

### Artwork

- The whale poses are existing assets reused verbatim through CSS transforms; no whale illustration was redrawn. Only the fish is new, and it is MIT-licensed separately from the DeepSeek stickers. See [artwork permission](ASSETS-LICENSE.md).

Wait for active tasks to finish before updating. Fully quit and reopen DSH after the update to load the new Host and client modules. No profile migration or restart is performed automatically.

## 0.2.9 — 2026-09-29

### Added

- Plugin manager icon, declared by the package manifest's top-level `icon` field (`assets/icon.svg`) and shown on installed bundle cards, detail pages and component rows.
- The icon embeds the complete working-state artwork **verbatim**, so the shipped illustration is not redrawn or retouched; a regression test fails if the icon and `assets/working.svg` ever diverge.

### Notes

- The icon is a manifest resource only. It is not embedded in the client runtime bundle, and `lib/client.js` is byte-identical to 0.2.8.
- The icon is drawn without a background plate. The plugin frame has no fill, so in the dark theme the black outline has low contrast against the page background and the silhouette is carried by the white belly and the bright blue body.

### Verification

- All automated checks pass, including a new manifest-icon contract test.
- The icon is validated against the DSH resolver rules (manifest-relative path, SVG, inside the package directory, within the 256 KiB limit) and confirmed present in the packed tarball.

Wait for active tasks to finish before updating. Fully quit and reopen DSH after the update to load the new Host and client modules. No profile migration or restart is performed automatically.

## 0.2.8 — 2026-09-24

### Fixed

- Restore reply-completion synchronization by calling `remote.whalePet` through a declared, lifecycle-owned child injection context after registering the namespace.
- Retry failed local Remote registration and coordinate shared mount cleanup without duplicating methods.
- Bound namespace readiness and cleanly handle cancellation, withdrawal and reconnects.

### Removed

- Temporary Sync diagnostics menu, report/clipboard controls, runtime diagnostic counters and diagnostic RPC.
- Prerelease installation instructions from the normal installation flow. This release uses npm's `latest` channel.

### Preserved

- Working and waiting states, current/global scope, dragging, size/motion/nap settings, greeting bubbles and artwork.
- Strict normal-completion semantics: cancellation, failure, history and falling work counts do not become success celebrations.
- Automated regression tests, including namespace capability checks that permissive Remote mocks previously missed.
- Entry ID `whale-pet`, module name `dsh-plugin-whale-pet`, existing preference format and separate code/artwork/font licenses.

### Verification

Normal-reply celebration was confirmed in the installed app with the namespace fix. The release also undergoes automated regression checks, isolated real Gateway/Cordis verification and offline browser checks. These do not certify every DSH version, platform or concurrent/reconnect scenario; see [compatibility notes](COMPATIBILITY.md).

Wait for active tasks to finish before updating. Fully quit and reopen DSH after the update to load the new Host and client modules. No profile migration or restart is performed automatically.
