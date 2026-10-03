# Speech Bubble Fonts and Licensing

The speech bubbles use two free, OFL-licensed fonts that permit commercial use. Both are embedded in the plugin: no requests are made to Google Fonts, CDNs, or other font services at runtime, and users do not need to install system fonts. The session count on the whale's computer screen continues to use the existing local monospace font, not these bubble fonts.

## Chinese: ZCOOL KuaiLe

- Source: [@fontsource/zcool-kuaile 5.3.0](https://registry.npmjs.org/@fontsource/zcool-kuaile/5.3.0), extracted from a pinned-version archive after SHA-512 verification. No npm package scripts were executed.
- Upstream: [ZCOOL KuaiLe project](https://github.com/googlefonts/zcool-kuaile).
- Copyright: Copyright 2018 The ZCOOL KuaiLe Project Authors.
- Original license: [OFL-ZCOOL-KuaiLe](<assets/fonts/OFL-ZCOOL-KuaiLe.txt>), copied byte-for-byte from the verified archive.
- Modifications: subset to retain only the glyphs assigned to the Chinese font that are needed by the current bubble text (`state.*`, `working.*`, `celebrate.*`, `error.*`, `pet.greeting`, and the opt-in balance phrases `pet.balance*`), and converted to WOFF2. Menu and settings translations are excluded from the subset. Glyph outlines have not been redrawn. As a modified version, the font has been renamed internally to **Whale Bubble Han**, with the PostScript name `WhaleBubbleHan-Regular` and weight 400.
- Output: [bubble-zh.woff2](<assets/fonts/bubble-zh.woff2>), 11,624 bytes.

## English: Fredoka 500

- Source: [@fontsource/fredoka 5.3.0](https://registry.npmjs.org/@fontsource/fredoka/5.3.0), extracted from a pinned-version archive after SHA-512 verification. No npm package scripts were executed.
- Upstream: [Fredoka project](https://github.com/hafontia/Fredoka-One).
- Copyright: Copyright 2016 The Fredoka Project Authors.
- Original license: [OFL-Fredoka](<assets/fonts/OFL-Fredoka.txt>), copied byte-for-byte from the verified archive.
- The original package's `fredoka-latin-500-normal.woff2` is used without any changes. Its actual OS/2 weight is 500. Its internal family name is `Fredoka Light Medium`, and its PostScript name is `FredokaLight-Medium`; these names come from the source file and do not indicate that a light weight is being used. The font can be registered at runtime under the independent CSS alias `Whale Bubble Latin`.
- Output: [bubble-en.woff2](<assets/fonts/bubble-en.woff2>), 16,248 bytes.

Together, the two font files total **27,872 bytes, approximately 27.2 KiB**. Coverage has been verified for every character actually used in the current bubble text. Menus, settings, the restore button, and other UI elements continue to use system UI fonts. Chinese glyphs used only in those elements, as well as `↗`, do not need to be included in the bubble subset, so new menu translations do not increase its size. Adding Chinese **bubble** text requires rebuilding the subset and checking coverage, rather than silently replacing unsupported characters with boxes.

## Commercial Use, Embedding, and Distribution

Both original licenses are the **SIL Open Font License 1.1**:

- Commercial use, modification, embedding, and distribution or sale together with software are permitted.
- Distribution must retain the corresponding copyright notices and the complete OFL text. This package includes both original license files.
- The fonts may not be sold by themselves.
- Modified versions must comply with the Reserved Font Name requirements. This project uses its own font name for the Chinese subset.
- The fonts and their modified versions remain subject to the OFL; they are **not relicensed under this project's MIT code license**. Pages or images created using the fonts are not required to adopt the OFL merely because they use these fonts.
- Upstream authors' names are used only for attribution and acknowledgment of contributions, not to imply endorsement of this plugin.

This document covers font licensing only and does not replace permission for the whale character illustrations.

## Reproducible Sources and Tools

Archive integrity:

```text
@fontsource/zcool-kuaile@5.3.0
https://registry.npmjs.org/@fontsource/zcool-kuaile/-/zcool-kuaile-5.3.0.tgz
sha512-jn4vpQ6QSVEckUn7uk5a9XcZMxEksTRqljmeE1VKRGMjGd6VoXdMyLGSdnTXSVwZLCCEHaIcm/2cdQuwvasJ9w==

@fontsource/fredoka@5.3.0
https://registry.npmjs.org/@fontsource/fredoka/-/fredoka-5.3.0.tgz
sha512-s2IhjQ50wDnKkkaKmjhtL0rxQg6ITsVusiipM3m7zUwVZZbbCKsscNDkngwp28xVzfIt7neWrkgU1qKqyTycQg==
```

This repository includes the processed fonts, complete license texts, and output manifest. Normal plugin builds and installation do not require downloading or reprocessing fonts.

The Chinese subset was created using fonttools. [tools/font-subset.py](tools/font-subset.py) reproduces it from the pinned source above in one step: it verifies the source SHA-256, keeps only the codepoints already in the manifest plus the balance phrases, strips layout and hinting tables, renames the modified font to the non-reserved name, rewrites the manifest, and refuses to write an output whose cmap does not cover every retained codepoint. When adding Chinese bubble text, add the new codepoints there, rebuild, and let the glyph coverage test in `tests/bubble.test.mjs` confirm the result.

Output filenames, actual family and PostScript names, glyph coverage, weights, sizes, and SHA-256 hashes are recorded in the [font manifest](<assets/fonts/manifest.json>).
