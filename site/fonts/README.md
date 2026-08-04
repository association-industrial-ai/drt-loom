# Fonts

Self-hosted, latin subset, variable where the family offers one. They are served
from the repository rather than from a font CDN because a `.eu` association site
should not hand every visitor's IP address to a third party in order to draw a
heading.

| File | Family | Licence |
| --- | --- | --- |
| `archivo-400-800.woff2` | [Archivo](https://github.com/Omnibus-Type/Archivo) — Omnibus Type | [SIL OFL 1.1](https://github.com/Omnibus-Type/Archivo/blob/master/OFL.txt) |
| `ibm-plex-sans-400-600.woff2` | [IBM Plex Sans](https://github.com/IBM/plex) — IBM | [SIL OFL 1.1](https://github.com/IBM/plex/blob/master/LICENSE.txt) |
| `ibm-plex-mono-400.woff2`, `ibm-plex-mono-500.woff2` | IBM Plex Mono — IBM | SIL OFL 1.1 |

Both licences permit redistribution of the font files, including embedded in a
document or bundled with software, provided the licence travels with them. That
is what this file is for. Neither family has been renamed, and the OFL's
Reserved Font Name clause is therefore not engaged.

The subsets are latin-only. `styles.css` declares the matching `unicode-range`
on the proportional faces — `U+0000-00FF, U+2000-206F, U+2190-21BB, U+2212` —
which covers the typographic quotes, the em dash, the arrows and the × the copy
actually uses. Regenerate with `pyftsubset` against that same range if the copy
grows a character outside it.
