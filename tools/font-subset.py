#!/usr/bin/env python3
"""Rebuild the embedded Chinese bubble font from the pinned upstream archive.

The bubble text is rendered with a subset of ZCOOL KuaiLe. Adding Chinese bubble
phrases therefore requires re-running this tool: the glyph coverage test in
`tests/bubble.test.mjs` fails when a phrase uses a character the subset lacks, so a
missing glyph can never ship as a blank box.

Requirements (see FONT-LICENSES.md for the pinned sources and SHA-512 checks):

    python3 -m venv .font-venv
    .font-venv/bin/pip install 'fonttools[woff]==4.63.0'
    .font-venv/bin/python tools/font-subset.py --source <extracted>.woff \
        --out assets/fonts/bubble-zh.woff2 --manifest assets/fonts/manifest.json

The source is `files/zcool-kuaile-chinese-simplified-400-normal.woff` inside
@fontsource/zcool-kuaile@5.3.0; the script verifies its SHA-256 against the
manifest before doing anything. Only the codepoints listed below are retained
(the existing manifest codepoints plus the balance phrases), glyph outlines are
never redrawn, and the OFL reserved-name requirement is met by renaming the
modified font to Whale Bubble Han / WhaleBubbleHan-Regular.
"""
import argparse
import hashlib
import json
import pathlib
import sys

SOURCE_SHA256 = '35a653aed1c462384b4a1f8944de928c0ccb0a346de700a53db5ece146840b52'
FAMILY = 'Whale Bubble Han'
POSTSCRIPT = 'WhaleBubbleHan-Regular'
# Added for the opt-in balance phrases: 「余额 {amount}」「余额读取失败」「显示余额」.
BALANCE_CODEPOINTS = [20313, 39069, 35835, 21462, 22833, 36133, 26174, 31034]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True, help='pinned zcool-kuaile chinese-simplified woff')
    parser.add_argument('--out', required=True, help='output woff2 path')
    parser.add_argument('--manifest', required=True, help='font manifest to update in place')
    args = parser.parse_args()

    from fontTools.ttLib import TTFont
    from fontTools.subset import Options, Subsetter, load_font, save_font

    source = pathlib.Path(args.source)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if digest != SOURCE_SHA256:
        print(f'refusing: {source} is not the pinned source (sha256 {digest})', file=sys.stderr)
        return 1

    manifest_path = pathlib.Path(args.manifest)
    manifest = json.loads(manifest_path.read_text())
    entry = next(font for font in manifest['fonts'] if font['language'] == 'zh')
    retained = sorted(set(entry['codepoints']) | set(BALANCE_CODEPOINTS))

    options = Options()
    # The bubble is decorative text on a translucent surface: OpenType layout and
    # hinting bytes cost size and change nothing visible at these sizes.
    options.layout_features = []
    options.hinting = False
    options.glyph_names = False
    options.drop_tables += ['GSUB', 'GPOS', 'GDEF', 'kern', 'DSIG']
    options.name_IDs = ['*']
    options.name_legacy = True
    options.name_languages = ['*']
    options.notdef_outline = False
    options.recalc_bounds = True

    font = load_font(str(source), options)
    subsetter = Subsetter(options=options)
    subsetter.populate(unicodes=retained)
    subsetter.subset(font)

    for record in font['name'].names:
        if record.nameID == 1:
            record.string = FAMILY
        elif record.nameID == 2:
            record.string = 'Regular'
        elif record.nameID == 4:
            record.string = f'{FAMILY} Regular'
        elif record.nameID == 6:
            record.string = POSTSCRIPT
        elif record.nameID == 16:
            record.string = FAMILY
        elif record.nameID == 17:
            record.string = 'Regular'

    out = pathlib.Path(args.out)
    save_font(font, str(out), options)
    # save_font drops the flavor, so the container is finalized from the written
    # sfnt bytes and only then hashed into the manifest.
    container = TTFont(str(out))
    container.flavor = 'woff2'
    container.save(str(out))
    if out.read_bytes()[:4] != b'wOF2':
        print('refusing: output is not a WOFF2 container', file=sys.stderr)
        return 1

    written = out.read_bytes()
    # Coverage is read back from the written file, not assumed from the subsetter.
    check = TTFont(str(out))
    covered = {code for table in check['cmap'].tables for code in table.cmap}
    missing = sorted(set(retained) - covered)
    if missing:
        print(f'refusing: written subset is missing {missing}', file=sys.stderr)
        return 1

    entry['bytes'] = len(written)
    entry['sha256'] = hashlib.sha256(written).hexdigest()
    entry['codepoints'] = sorted(covered)
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
    print(f'wrote {out} ({len(written)} bytes, {len(covered)} codepoints, source sha256 verified)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
