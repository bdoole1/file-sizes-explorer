# File Sizes Explorer

Tiny, fast badges in the VS Code Explorer showing file sizes. Hover to see exact bytes/MB. Optional recursive folder sizes.

![screenshot](images/screenshot.png)

## Features
- 2‑character size badges (`B`, `1K…`, `K`, `1M…`, `M`, `1G…`)
- **Subtle mode:** minimal dot with full tooltip (nearly invisible until hover)
- **Status bar** readout for the active file
- **Optional folder sizes**, with exclude globs

## Settings
| Setting | Type | Default | Description |
|---|---|---:|---|
| `explorerFileSizes.badgeMode` | `full` \| `subtle` \| `off` | `subtle` | How badges render in the Explorer. |
| `explorerFileSizes.enableFolderSizes` | boolean | `false` | If true, compute folder sizes recursively (can be slow on very large trees). |
| `explorerFileSizes.excludeGlobs` | string[] | `["**/node_modules/**","**/.git/**","**/dist/**","**/build/**"]` | Paths to skip when computing folder sizes. |

## Performance tips
- Keep folder sizes off for huge monorepos.
- Add `**/dist/**`, `**/build/**`, and language‑specific artifacts to `excludeGlobs`.

## Known limitations
- VS Code file decorations support a max **2‑character** badge.
- Explorer doesn’t support a dedicated “Size” column.

## Install
- From VSIX: `code --install-extension explorer-file-sizes-0.0.1.vsix`
- Marketplace (soon): search for **File Sizes Explorer**

## License
MIT