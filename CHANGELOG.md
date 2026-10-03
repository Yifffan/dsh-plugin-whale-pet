# Changelog

## Unreleased

### Added

- Opt-in DeepSeek balance in the bubble (`setting.balance`, off by default). The Host reads `GET /user/balance` with the `DEEPSEEK_API_KEY` credential, caches a successful reading for 60 seconds, and re-reads after each finished turn or when a click finds the shown reading stale.
- A second strict Remote method, `whalePet.balance`, plus the `WhaleBalance` schema. Amounts are returned as the server's own decimal strings; unknown currencies and malformed amounts are dropped rather than coerced.
- Failures are explicit and phrase-only: an absent, rejected or unreachable credential renders one localized sentence and never a partial or stale figure.
- A reproducible Chinese bubble-font build ([tools/font-subset.py](tools/font-subset.py)) that verifies the pinned source hash, adds the eight new glyphs, renames the modified font to its non-reserved name, and rewrites the manifest; the glyph coverage test still fails any uncovered phrase.

### Notes

- Balance rendering is off until enabled, so an unconfigured installation behaves exactly as before.
- The Host half gains one outbound call; it still opens no port, reads no session content, and never forwards the credential.

