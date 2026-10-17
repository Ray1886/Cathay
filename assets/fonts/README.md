# Lounge Sans TC

The bundled interface font is a renamed, modified WOFF2 subset of Noto Sans TC. It is an interface asset, not Cathay's official typeface.

- Asset: lounge-sans-tc.woff2
- Local family: Lounge Sans TC
- Size: 202,808 bytes
- Unicode coverage: 822 codepoints
- Internal variable axis: wght 100–900
- CSS range: normal 400–600, with font-display: swap and font-synthesis: none
- SHA-256: ebf388b8106100ff8bf3eb4a5b3da507ed79ea8a1abf71397867d066b3b6de04

Source: [Google Fonts Noto Sans TC variable TTF](https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf). [Upstream metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/METADATA.pb) identifies Noto Sans TC and its weight axis. The source uses a moving main-branch URL; an exact upstream revision was not recorded for this asset.

The derivative retains SIL Open Font License 1.1 metadata. The accompanying [OFL.txt](OFL.txt) preserves the upstream copyright, license and Reserved Font Name notice. Distribute this file alongside the font and retain the derivative's Lounge Sans TC name.

The subset is not full CJK coverage. It supports the bundled interface corpus; arbitrary Chinese chat input, new translations and characters outside its cmap use the system fallback. The current stack is Lounge Sans TC, the system UI, PingFang TC, Microsoft JhengHei and sans-serif. Font preloading is defined in index.html; the local face and fallback stack are defined in styles.css.

When updating the font:

1. Collect the changed interface strings, including booking, queue, proposal, recovery and error text. Retain required Latin characters, numbers and punctuation.
2. Subset an explicitly recorded upstream revision with a maintained font-subsetting tool and WOFF2 encoder. Preserve the OFL notices and derivative naming; do not rely on a temporary build directory or undocumented generator.
3. Verify the resulting cmap, family/license names and weight axis. Keep CSS weights aligned with the intended 400–600 usage and keep system fallback for unbundled glyphs.
4. Check the updated UI for missing glyphs, font loading, fallback and layout shifts. Update this README's byte count, coverage, hash and source revision whenever the asset changes.

The size, cmap count, axis, names and license metadata above were inspected from the bundled asset during the visual refinement. This does not verify every possible user-entered character.
