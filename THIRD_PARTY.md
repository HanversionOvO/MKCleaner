# Third-party software

## Mole

MkCleaner does not implement its own cleanup logic. Every scan, deletion and
system query is performed by **Mole**, which ships inside this app at
`MkCleaner.app/Contents/Resources/mole/`.

| | |
|---|---|
| Project | https://github.com/tw93/Mole |
| Homepage | https://mole.fit |
| Version bundled | 1.48.1 (tag `V1.48.1`) |
| License | GNU General Public License v3.0 or later |

### Source code

The exact sources for the version in this app are:

    https://github.com/tw93/Mole/archive/refs/tags/V1.48.1.tar.gz
    sha256 374dcdc981d0581cdf5007311fb5bf4cfe326ad5fe2a7735ffc44a3f7c91b049

`scripts/vendor-mole.sh` fetches that archive, verifies the digest, applies a
modification patch, builds the two Go helpers (`analyze-go`, `status-go`) as
universal binaries, and copies the tree into the bundle. The full GPL-3.0 text
ships at `Contents/Resources/mole/LICENSE` and at the root of this repository.

### Modifications

The bundled engine is **not verbatim** — `scripts/mole-patches.py` (a
programmatic patch with assertions, applied during vendoring) removes the
surfaces a bundled engine must not expose:

- `mo uninstall` — removed from the CLI dispatch and the interactive main menu
- `mo update` / `mo remove` — would rewrite or delete the engine inside .app,
  breaking the code signature; removed from the CLI dispatch, and the update
  key in the main menu is inert
- `mo installer` / `mo completion` — system-wide file removal and shell config
  writes; removed from the CLI dispatch
- The overview help text no longer lists any of the above

Everything else — clean, optimize, analyze, status, history, purge, touchid —
is untouched. The patch is re-applied on every vendoring run; upgrading to a
new Mole version requires the patch to be re-validated against the new source.

### Trademark

"Mole" and the Mole logo are trademarks of the Mole project, and are not covered
by the GPL. Per Mole's [trademark policy](https://github.com/tw93/Mole/blob/main/TRADEMARK.md),
MkCleaner uses its own name and icon, and does not claim endorsement by or
affiliation with Mole. Mole for Mac (https://mole.fit) is a separate,
proprietary product with no connection to this app.

### Why MkCleaner is also GPL-3.0

MkCleaner is distributed together with Mole and exists to drive it. Rather than
argue about where the boundary between the two falls, MkCleaner is released
under the same license. See `LICENSE`.

## Newsreader

The display typeface, used for numerals.

| | |
|---|---|
| Project | https://github.com/productiontype/Newsreader |
| License | SIL Open Font License 1.1 |

Bundled at `public/fonts/newsreader-latin-var.woff2` (latin subset, variable).
