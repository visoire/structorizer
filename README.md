<p align="center">
  <img src="assets/app-icon/hicolor/256x256/apps/io.github.visoire.structorizer.png" width="128" height="128" alt="Structorizer Web icon">
</p>

<h1 align="center">Structorizer Web</h1>

A browser version of [Structorizer](https://structorizer.fisch.lu), the Nassi-Shneiderman
diagram (structogram) editor used in many schools. It runs completely on your device, in any
current browser, including Safari on iPad (desktop issue
[#1244](https://github.com/fesch/Structorizer.Desktop/issues/1244)).

- **Free and open source**: GPL-3.0-or-later, like Structorizer Desktop.
- **Private by design**: no server, no account, no cookies, no tracking, no external
  resources. Both builds enforce this with a Content Security Policy (`connect-src 'none'`).
- **Compatible**: reads and writes the `.nsd` files of Structorizer Desktop 3.32.

Version **3.32-35** (web build `3.32.35-web.10`) · **[Live Web App (GitHub Pages)](https://visoire.github.io/structorizer/)** · **[Single-File Edition](https://visoire.github.io/structorizer/structorizer-single.html)** · [Documentation](https://visoire.github.io/structorizer/docs/) · [Changelog](CHANGELOG.md) ·
[Roadmap](ROADMAP.md)

<p align="center">
  <img src="docs/images/showcase.png" alt="Structorizer Web in light mode showing the CoffeeProtocol easter egg diagram with live Python Code preview" width="860">
</p>
<p align="center">
  <img src="docs/images/showcase-dark.png" alt="Structorizer Web in dark mode showing the CoffeeProtocol diagram and Python Code preview" width="860">
</p>
<p align="center"><sub><b>CoffeeProtocol</b> (<code>File → Examples</code>): live Python Code preview synchronized with the selected diagram element, in light and dark mode.</sub></p>

## Two versions

| | Web version | Single-file version |
|---|---|---|
| What | `index.html` + `assets/` + documentation page with the user guide | one self-contained `index.html` (about 530 KB) |
| For | web servers (school server, XAMPP, GitHub Pages, Nextcloud) | upload anywhere, USB stick, course pages, e-mail |
| Download | `structorizer-web-<version>.zip` | `structorizer-<version>.html` or `structorizer-single-<version>.zip` |

Both are in the [releases](https://github.com/visoire/Structorizer/releases). Hosting notes:
[main/web/packaging/HOSTING.md](main/web/packaging/HOSTING.md).

## Features

- Menus like Structorizer Desktop 3.32 (File, Edit, View, Diagram, Preferences, Debug, Help) and its key bindings
- All 11 element types, programs, subroutines and includables, several diagrams open at once
- Side panel with **Code preview** (selection ⇄ code lines) and **Arranger index**
- Code export: Python, Java, JavaScript, C, C++, C#, Pascal, PHP, Bash
- Pictures: PNG, PNG (multiple), EMF, PDF, SVG; print; copy as picture
- Find/replace, transmute, outsource, collapse, disable, undo/redo, drag and drop, context menu
- Preferences: 13 UI languages (English default, plus German, French, Dutch, Luxembourgish, Spanish, Portuguese (Brazil), Italian, Simplified & Traditional Chinese, Czech, Russian, Polish — loaded lazily per chunk), light/dark/system, view options, parser keywords,
  **fonts** for the interface and for diagrams/exports (any installed font), export colours
- Design in the style of the Craft apps (GridCraft, WordCraft), touch friendly
- **Executor & Debugger**: resizable and dockable (`Bottom`, `Top`, `Left`, `Right`) step-by-step and continuous execution (`Ctrl+R`) with variable watch (editable while paused), breakpoints (`Ctrl+B`), call stack, multi-diagram subroutine calls, and runtime coverage/execution count overlay
- **Turtleizer Studio** (`Ctrl+Shift+R`): draggable, resizable, or dockable turtle graphics studio supporting `forward`, `backward`, `left`, `right`, `penUp`/`penDown`, `gotoXY`, `setPenColor`, `setPenWidth`, `circle`/`arc`, `home`, `writeTurtle`, pan/zoom, coordinate grid, and SVG/PNG export (plus Python/Java/C# code export `#1237`)
- **Static Analyser & Content Assist**: `A01`–`A09` static diagram checks (`F3`) with canvas warning triangles, interactive Side Panel findings list, and live autocomplete chips (`Tab` completion) inside the Element Editor
- **2D Arranger Surface & `.arr`/`.arrz` Archives**: free-form 2D Arranger board (`Ctrl+Shift+A`) with draggable/pinnable diagram cards and pure-TypeScript `.arrz` / `.arr` import and export
- **iPadOS, Apple Pencil & Magic Keyboard**: W3C Pointer Events Level 3 (`pressure`, `twist`, spherical/cartesian tilt), M2+ Apple Pencil hover preview, `TouchArbitrator` palm rejection (`LoneFingerHold`), 2-finger tap Undo / 3-finger tap Redo, OwlLuna-style `InkDish` radial tool palette at the Pencil tip, `VisualViewport` virtual keyboard adaptation, Magic Keyboard `⌥1..⌥-` / `⌘9` shortcuts, and Capacitor native wrapper config ([docs/ipados-native-guide.md](docs/ipados-native-guide.md))
- **PWA**: installable offline web app with precache service worker (`sw.js`)
- Documentation page with the Structorizer User Guide (PDF)
- MCP server for AI assistants (`main/mcp`, `21` tools over `stdio` and Streamable HTTP `--http <port>`)

## Develop

Requirements: Node.js 20 or newer.

```bash
cd main/web
npm install
npm run dev            # development server with hot reload
npm test               # unit tests (Vitest)
npm run build          # web version into main/web/dist
npm run build:single   # single-file version into main/web/dist-single
```

### Release script

```bash
./scripts/release.sh                 # install, test, build both versions + MCP, package into release/
./scripts/release.sh --skip-tests
./scripts/release.sh --publish       # also push, tag v<version> and create the GitHub release (needs gh)
```

The packaging step alone: `node scripts/package.mjs`.

The user guide PDF belongs to the desktop project and is not in the repository. To show it
on the documentation page, put `structorizer_user_guide_3.32-35.pdf` from the
[Structorizer downloads](https://structorizer.fisch.lu) as
`main/web/public/docs/structorizer-user-guide-3.32-35.pdf` before building.

### MCP server

```bash
cd main/mcp
npm install
npm test                                        # builds and runs the end-to-end check
node dist/cli.js mcp --root /path/to/diagrams
claude mcp add structorizer -- node /path/to/main/mcp/dist/cli.js mcp --root /path/to/diagrams
```

Tools (`21` tools, all annotated, plus MCP resources & prompts): `list-commands`, `list-diagrams`,
`read-diagram`, `diagram-info`, `validate-diagram`, `analyse-diagram`, `execute-diagram`, `find-in-diagrams`,
`replace-in-diagram`, `create-diagram`, `update-diagram`, `add-element`, `update-element`, `delete-element`,
`move-element`, `transmute-element`, `batch`, `export-code`, `export-picture`, `pack-arrz`, `unpack-arrz`.

### Project layout

| Path | Content |
|---|---|
| `main/web/src/core` | model, `.nsd` reader/writer, tokenizer, layout, SVG/EMF/PDF writers, code generators |
| `main/web/src/store` | application state, documents, preferences |
| `main/web/src/ui` | React components (menu bar, ribbon, side panel, dialogs) |
| `main/web/docs` | documentation page |
| `main/web/packaging` | hosting files for the release packages |
| `main/web/tests` | unit tests and fixtures |
| `main/mcp` | CLI and MCP server |
| `scripts` | release and packaging scripts |
| `docs/` | source analysis, file format, language & executor specs, layout spec, decisions, iPadOS guide |
| `assets/` | application icons and icon source (`original.psd`, `hicolor`) |
| `ROADMAP.md` | open roadmap items (compared with Structorizer Desktop 3.32-35) |

## Credits

Structorizer was created by Bob Fisch and is maintained by Bob Fisch, Kay Gürtzig and
contributors ([fesch/Structorizer.Desktop](https://github.com/fesch/Structorizer.Desktop)).
This web version is an independent reimplementation in TypeScript. Its layout rules, file
format, menus and key bindings follow the desktop source code and user guide. The example
`hilbert-3.nsd` is a desktop sample by Kay Gürtzig (GPLv3). The visual design follows the
design tokens of the Craft apps; no code or assets were copied from them.

"Structorizer" refers to the original project; this repository is not an official release
of the desktop team.

## License

GNU General Public License v3.0 or later, see [LICENSE](LICENSE).
