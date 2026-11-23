# Changelog – Structorizer Web

All notable changes to the **web version** are documented here. The desktop version
has its own changelog (`sourcecode/changelog.txt`, not part of this repository).

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Since 3.32.35-web.2 the
version follows the desktop version it corresponds to (Structorizer 3.32-35), plus a web
build number. Desktop issue numbers refer to
[fesch/Structorizer.Desktop](https://github.com/fesch/Structorizer.Desktop/issues).

## [Unreleased]

## [3.32.35-web.10] – 2026-11-23 (corresponds to Structorizer 3.32-35)

Fixes for the first feedback of the Structorizer Desktop maintainer (7 points, e-mail of
2026-11-23). Each point is covered by a regression test in `main/web/tests/owner-fixes.test.ts`.

### Fixed
- **Root comment in "Comments plus texts?"** (point 1): the comment of the diagram frame was never
  drawn. It now appears muted above the title (above the include list) like in Structorizer Desktop
  (`Root.prepareDraw/draw`, enh. #128), and "Switch text/comments?" shows the root comment instead
  of the title. `core/layout/layout.ts`.
- **Comment pop-up on hover** (point 2): with "Show comments?" on, resting the mouse (or the Apple
  Pencil hover) on a commented element or on the diagram frame shows its comment in a tooltip after
  about half a second. `ui/DiagramView.tsx`, `styles.css`.
- **Step after an OUTPUT element** (point 3): one Step used to stop on the OUTPUT element again
  (its output event counted as a step), so a second Step was needed. Step now runs on to the next
  element. Related: after answering an INPUT prompt while stepping, execution continued as "Run";
  it now stays in step mode. `store/execStore.ts`.
- **"Smart" record initializers** (point 4): `today <- Date{2026, 11, 23}` now works after
  `type Date = record{year: int; month, day: short}`. Values without a component name fill the
  components in declaration order; from the first named component on, further unnamed values are
  ignored (user guide, "Records / Structs"). Two parser bugs caused this: every item in `Type{...}`
  was read as `name: value`, and in the type definition a component list like `month, day: short`
  lost `month`. `core/lang/parser.ts`, `core/exec/executor.ts`; the code preview keeps unnamed
  values as plain values (`core/gen/expr.ts`).
- **Lines vanished when zooming out** (point 6): below 100 % the stroke width shrank under one
  pixel and disappeared with crisp edges. Lines now keep at least one device pixel at every zoom
  (exports are unchanged). `core/render/svg.ts`.

### Changed
- **Resetting execution counts / coverage** (point 5): like the desktop's "Collect Run Data", the
  counts now add up over several runs while **Coverage** is on, and a new **Reset** button next to
  it clears them. Switching Coverage off clears them as well. Tooltips explain both.
  `store/execStore.ts`, `ui/ExecutorPanel.tsx`.

### Added
- **Arrangement groups (basic)** (point 7): opening an `.arrz` puts its diagrams into a group named
  after the file (as in the desktop Arranger). The Arranger index then lists the diagrams by group
  (collapsible, with count) plus a default group; each group can be saved as `.arrz`, renamed or
  dissolved (the diagrams stay open), and the folder button on every diagram puts it into a new or
  existing group or takes it out. The Arranger board draws a labelled frame around each group.
  Groups are kept in the local session. Not yet: a diagram in several groups, moving whole groups
  on the board, group colours (see ROADMAP). `store/diagramStore.ts`, `ui/SidePanel.tsx`,
  `ui/DiagramView.tsx`, `ui/actions.ts`, `ui/exporters.ts`.
- 11 new UI strings in all 13 languages (coverage reset, groups).
- MCP server/CLI: no code change needed. It uses the same parser and executor, so `run` and
  `execute-diagram` handle smart record initializers too (checked with the CLI).

## [3.32.35-web.9] – 2026-11-19 (corresponds to Structorizer 3.32-35)

UI/UX pass: small fixes that make everyday editing on desktop and iPad smoother.

### Changed
- **Drag and drop of elements**: the whole element is now a drop zone, not only the thin line
  between two elements. Upper half of an element inserts before it, lower half after it; for
  IF/CASE/loops the header decides, so big loop bodies are no dead zone. Empty branches take the
  element, the title inserts at the top, below the diagram appends. While dragging, the source is
  dimmed, a label follows the pointer and the view auto-scrolls at the edges (mouse, touch, Pencil).
- **Panel controls**: the side panel's "switch sides" button and the Executor's position button sit
  next to the close button (they used to drift to the middle). The Executor position is now a small
  menu with all four positions and dock icons.
- **Zoom and scroll**: Ctrl/Cmd + wheel and trackpad pinch zoom at the pointer, touch pinch zooms at
  the pinch centre, toolbar zoom keeps the view centre. Drag on the empty desk (or with the middle
  mouse button) pans the diagram. Zooming no longer jumps back to the selection.
- **Context menu**: it measures itself and opens upwards/leftwards when there is no room, and
  scrolls when the screen is too short, so the last items (Toggle breakpoint) are always visible.
- **Dialogs**: only the dialog body scrolls, head and buttons stay visible; the height follows the
  visual viewport, so the iPad keyboard never hides the OK button. Preferences tabs stay on top while
  scrolling. On phones dialogs open as a full-width bottom sheet.

### Added
- **Open .nsd/.arrz/.arr by drag and drop** from Explorer, Finder or the iPad Files app (Split View),
  with a drop overlay. Installed PWAs register as file handler for .nsd/.arrz/.arr (Chromium).

### Fixed
- Making the Executor panel taller than about 300 px pushed it over the menu bar and toolbar. The
  bars no longer shrink, the panel is limited to the free space and the diagram keeps 140 px.
- Live app URL is now lowercase: https://visoire.github.io/structorizer/

## [3.32.35-web.8] – 2026-11-18 (corresponds to Structorizer 3.32-35)

Added Static Analyser (`A01`–`A09`), Content Assist, 2D Arranger Board (`.arr`/`.arrz` archives), Turtleizer Studio & code export, resizable/dockable Executor and Side Panel across all 13 locales, Capacitor iPadOS native wrapper configuration, and MCP Server execution/analysis/HTTP enhancements.

### Added
- **Phase 3a Static Analyser & Content Assist (`src/core/lang/analyser.ts`, `src/ui/DiagramView.tsx`, `src/ui/SidePanel.tsx`, `src/ui/ElementEditor.tsx`)**:
  - Static diagram checks `A01` (empty text), `A02` (uninitialized variable read), `A03` (`FOR` loop counter modified in body), `A04` (potential endless loop with `i++`/`inc` awareness, desktop issue #1081), `A05` (constant reassignment), `A06` (unparseable `FOR` header), `A07` (empty branches / missing `CASE` discriminator), `A08` (missing function return), and `A09` (missing subroutine/includable in pool).
  - Red warning triangles (`Element.drawWarningSignOnError` parity) on the diagram canvas (`F3` toggle), interactive Analyser list in the Side Panel, and live warnings + Content Assist autocomplete chips (`Tab` completion) inside the element editor.
- **Phase 3b Arranger 2D Board & `.arr`/`.arrz` Archives (`src/core/io/arranger.ts`, `src/ui/DiagramView.tsx`, `src/ui/exporters.ts`)**:
  - Interactive 2D Arranger surface (`Ctrl+Shift+A` or `Board` button in Arranger index) displaying all open diagrams as movable, pinnable cards with live SVG rendering and grid auto-layout.
  - Pure-TypeScript PKZIP reader/writer with RFC 1951 raw DEFLATE decompression for desktop-compatible `.arrz` and `.arr` import and export (`Archivar.java` parity).
- **Phase 3c Turtleizer Code Export (`src/core/gen/expr.ts`, desktop issue #1237)**:
  - Translates Turtleizer routines (`forward`/`fd`, `backward`/`bk`, `left`/`rl`, `right`/`rr`, `penUp`, `penDown`, `gotoXY`, `setPenColor`, `setBackgroundColor`, `clear`, `hideTurtle`, `showTurtle`) to `turtle.*` (with `import turtle`) in Python and `Turtleizer.*` in Java/C#.
- **MCP Server Enhancements (`main/mcp/src/server.ts`, `cli.ts`)**:
  - Added 4 new tools (21 total): `execute-diagram` (headless execution with `inputs`, `args`, final variables, coverage, and Turtleizer segment count), `analyse-diagram` (`A01`–`A09` static analysis), `pack-arrz`, and `unpack-arrz`.
  - Added Streamable HTTP MCP transport (`structorizer-cli mcp --http <port>`) alongside `stdio`, plus `structorizer-cli analyse` and `structorizer-cli run` CLI subcommands.
- **Phase 5 Native iPadOS Wrapper (`main/web/capacitor.config.json`, `docs/ipados-native-guide.md`)**:
  - Added Capacitor configuration (`io.github.visoire.structorizer`) and iPadOS packaging guide with `UTExportedTypeDeclarations` for `.nsd` and `.arrz` files.

## [3.32.35-web.7] – 2026-11-18 (corresponds to Structorizer 3.32-35)

Added full Executor & Debugger, Turtleizer, Pratt AST parser, multi-selection, branch head colouring, PWA offline service worker, and comprehensive iPadOS / Apple Pencil / Magic Keyboard integration.

### Added
- **Phase 2 Language & AST Parser (`src/core/lang/lexer.ts`, `parser.ts`, `docs/language-spec.md`)**:
  - Keyword-aware tokenizer (`tokenizeWithKeywords`) supporting multi-word per-diagram keywords and line-continuation backslashes (`joinContinuedLines`).
  - Pratt expression parser (`parseExpr`) and statement parser (`parseStmt`) with permanent cached element ASTs (`getElementAst`, desktop issue #800), record/array literals, and Pascal/C/BASIC declarations (#980).
- **Phase 2 Executor & Debugger (`src/core/exec/executor.ts`, `src/store/execStore.ts`, `src/ui/ExecutorPanel.tsx`, `docs/executor-spec.md`)**:
  - Pure generator-based interpreter (`function*`, no `eval` / `new Function`, D-14) covering all 11 element types, `leave` / `return` / `exit` / `throw`, `Try`/`Catch`/`Finally`, and `Parallel` branch interleaving.
  - Built-in math, string, array, record, and conversion functions (`strToInt`, `strToDouble`, `strToBool`, `pos`, `copy`, `inc`, `dec`, desktop issues #408, #530).
  - Multi-diagram subroutine call resolution by `(name, arity)` and `includeList` includables across all open diagrams in the Arranger pool (P2-08).
  - Interactive debugger control panel (`Ctrl+R`): Run/Resume, Step, Pause, Stop, speed slider (`0–800 ms`), subroutine parameter bar, live editable variable watch table, call stack, `INPUT` prompt, `OUTPUT` console, breakpoints (`Ctrl+B`, red top bar), and runtime coverage / execution count (`×N`) overlay (P2-06, P2-07, P2-09).
- **Turtleizer (`src/core/exec/turtle.ts`, `src/ui/ExecutorPanel.tsx`)**:
  - Integrated turtle graphics controller (`Ctrl+Shift+R`) supporting `forward`/`fd`, `backward`/`bk`, `left`/`rl`, `right`/`rr`, `penUp`/`penDown`, `gotoXY`/`gotoX`/`gotoY`, `setPenColor`, `setBackgroundColor`, `clear`, `getX`/`getY`/`getOrientation`, and standalone SVG export.
- **iPadOS, Apple Pencil & Magic Keyboard (`src/ui/ipad.ts`, `src/ui/DiagramView.tsx`, `src/ui/App.tsx`)**:
  - `HardwareFeatureDetector` & W3C Pointer Events Level 3 `TiltMathConverter` (spherical `altitudeAngle`/`azimuthAngle` ⇄ cartesian `tiltX`/`tiltY`, 240 Hz `getCoalescedEvents()`, Apple Pencil USB-C simulated-pressure fallback, Barrel Roll `twist`, and Squeeze detection).
  - `TouchArbitrator` (ported from OwlLuna's `StrokeHold.swift` & `PencilGestures.swift`): `LoneFingerHold` palm rejection while the Apple Pencil is active or within 500 ms of lifting, plus 2-finger tap Undo and 3-finger tap Redo on the diagram canvas.
  - OwlLuna-inspired `InkDish` radial tool palette (`QuickDish`, `⌘K`, Apple Pencil squeeze, or Pencil double-tap on empty desk) with all 11 element types arranged around the rim and `Undo`/`Redo`/`Edit`/`Delete` in the center grid.
  - Apple Pencil Hover preview on M2+ iPad Pro/Air (`pointerType === 'pen'` with `buttons === 0`), `window.visualViewport` virtual keyboard height adaptation, and Magic Keyboard `⌥1..⌥-` element insertion & `⌘9` Fit to Window shortcuts.
- **Phase 1e Editor Completions**:
  - **P1-26 PWA**: `pwaPlugin` in `vite.config.ts` emits `dist/sw.js` precaching the exact build assets for full offline operation.
  - **P1-28 Multi-selection**: `Shift+↑/↓` and `Shift+Click/Tap` select a contiguous range of elements in a sequence; delete, cut, copy, paste, duplicate, move up/down, drag-and-drop, disable, outsource, and transmute work on the range.
  - **P1-29 Branch head colours**: tap any branch header triangle/trapezoid of an `IF` or `CASE` element to colour it via a floating swatch bar (compatible with Structorizer Desktop 3.32-30 `branch_colors`).
  - **P1-30 Transmute merge/split**: `Ctrl+T` on multiple selected instructions merges them into a single multi-line instruction; `Ctrl+T` on a multi-line instruction splits it into a selected range of single-line instructions.

## [3.32.35-web.6] – 2026-11-18 (corresponds to Structorizer 3.32-35)

### Changed
- **Frontend polish**: removed the thick bottom accent border from checked toggle icon buttons (keeping only the soft background tint cleanly) and restored green / red / blue functional colours (`--ok` green for saved status & success toasts, `--danger` red for errors & unsaved `•` indicators, `--info` blue for links, focus rings & info toasts).

## [3.32.35-web.5] – 2026-11-18 (corresponds to Structorizer 3.32-35)

Fixed empty PDF printing, upgraded UI accent to Structorizer icon yellow with tactile active toggle tiles, added unsaved-changes leave protection, and expanded the MCP server on the Craft model.

### Fixed
- **Print / Save as PDF**: moved `#print-area` outside `.app` (so `.app { display: none !important; }` in `@media print` no longer hides the printed SVG), added `beforeprint`/`afterprint` listeners so browser-initiated printing works too, and made `printDiagram()` trigger synchronous layout before `window.print()`.
- **Unsaved-changes leave prompt**: `beforeunload` now warns whenever any open diagram has unsaved changes (`anyDirty`), even when browser autosave succeeds.

### Changed
- **UI design & accent colour**: replaced the teal accent with strong golden yellow (`#fbc700`) matching the Structorizer app icon in both light and dark modes, and styled active toggle Icon Buttons as rounded squares with a soft yellow tint and a 4 px bottom accent bar (`border-bottom: 4px solid var(--app)`).

### Added
- **MCP server (`main/mcp`, Craft parity)**: expanded from 10 to 17 fully annotated tools (`list-commands`, `validate-diagram`, `find-in-diagrams`, `replace-in-diagram`, `update-diagram`, `transmute-element`, `batch`, plus subtree `read-diagram`, automatic workspace subroutine resolution in `export-code`, and themed/inline `export-picture`), added MCP resources (`structorizer://reference/syntax`, `structorizer://diagram/{+path}`), MCP prompts (`create-algorithm`, `review-diagram`), and `info`/`validate`/`find`/`export` CLI subcommands.

## [3.32.35-web.4] – 2026-11-18 (corresponds to Structorizer 3.32-35)

Full desktop localization (13 languages, English default), C / C# / Pascal code export, and repository cleanup.

### Added
- **All 13 UI languages of Structorizer Desktop** (`en`, `de`, `fr`, `nl`, `lu`, `es`, `pt-br`, `it`, `zh-cn`, `zh-tw`, `cs`, `ru`, `pl`) in `Preferences > Language` and the Preferences dialog.
- **Lazy-loaded i18n bundles**: English is bundled eagerly as the default/fallback language while the other 12 dictionaries split into tiny on-demand JS chunks in the web build and inline seamlessly into the single-file build.
- **Code export for C, C#, and Pascal** in addition to Python, Java, JavaScript, C++, PHP, and Bash (including expression/builtin translations, `Code preview`, `File > Export > Code`, and MCP `export-code`).

### Changed
- **Main UI language**: English (`en`) is now always the default UI language instead of overriding to German via `navigator.language`.
- **Workspace cleanup**: removed local reference folders and duplicate root PDFs, and removed obsolete ignore rules from `.gitignore`.

## [3.32.35-web.3] – 2026-11-18 (corresponds to Structorizer 3.32-35)

New look in the style of the Craft apps (GridCraft, WordCraft), custom Structorizer icons,
a single-file version, font settings and a release script.

### Changed
- **Icons**: replaced the placeholder SVG icon and logos across the editor, documentation page,
  favicons, Apple touch icon, and web manifest with the Structorizer icon set (`assets/app-icon/`).
- **Default diagram name**: new unnamed diagrams (`???`) now use `structorizer` in the title bar
  and suggest `structorizer.nsd` when saving instead of `___` / `___.nsd`.
- **Design** follows the Craft design tokens: neutral grey title bar, ribbon and desk,
  flat icon buttons with hover and pressed states, checked tools with a soft accent and an
  accent underline, 4 px widget corners, 8 px menus, 10 px dialogs with soft popup shadows,
  13 px UI font. Structorizer has its own app colour (teal), like GridCraft green and
  WordCraft blue. Light and dark palettes rebuilt on the same tokens.
- **Toolbar** as ribbon groups with labels (Insert, Edit, View).
- **Menus**: compact desktop rows, dim shortcuts, rotating submenu arrows, open animation.
- **Dialogs**: header with close button, scrollable body, footer bar for the buttons,
  open animation, tabs with an animated underline.
- **Controls**: new buttons (secondary, primary, danger, small), selects with a custom arrow,
  focus line on inputs, rounded colour swatches, status dot in the status bar (with selected
  element comments shown inline), clean flat toasts without left accent borders, and Arranger
  index close buttons that appear on hover.
- Larger targets on touch screens (`pointer: coarse`); motion is reduced when the system asks for it.

### Added
- **Easter egg example**: bundled `CoffeeProtocol` (`main/web/src/examples/coffee-protocol.nsd`)
  under `File → Examples` and added light/dark showcase screenshots in `docs/images/`.
- **Fonts** (Preferences › Fonts): font of the user interface and font of diagrams and
  exports, each from system font, Arial/Helvetica, Verdana, serif, monospace, rounded or any
  other installed font by name; diagram font size 10 to 22 px with a live preview. Only
  fonts on the device are used, nothing is downloaded.
- **Export look**: element colours on/off for pictures, transparent PNG background. SVG,
  PNG, PDF and EMF use the diagram font (EMF picks the first installed face).
- **Single-file version** (`npm run build:single`): one self-contained `index.html`
  (about 420 KB) with inlined script and styles; the Content Security Policy allows exactly
  that script by its SHA-256 hash, so the single file is just as locked down.
- **Release packages** like the Craft web packages: `structorizer-web-<v>.zip` (with
  `.htaccess`, `_headers`, `HOSTING.md`), `structorizer-single-<v>.zip`,
  `structorizer-<v>.html`, `structorizer-mcp-<v>.zip`, `SHA256SUMS.txt`.
- **`scripts/release.sh`**: installs, tests, builds both web versions and the MCP server,
  packages everything and with `--publish` pushes, tags and creates the GitHub release.
  Packaging itself is `scripts/package.mjs` (Node, no dependencies).

### Fixed
- Menus no longer throw when a pointer event comes from a non-element target.
- Fit to window accounts for all 64 px of canvas padding so fitted diagrams no longer
  overflow into scrollbars.

## [3.32.35-web.2] – 2026-11-18 (corresponds to Structorizer 3.32-35)

Desktop-like menus and functions, side panel with Code preview and Arranger index, code
export, more picture formats, light/dark mode, documentation and an MCP server.

### Added
- **Menu bar like Structorizer Desktop 3.32**: File, Edit, View, Diagram, Preferences, Debug,
  Help with the desktop items and shortcuts. On narrow screens one *Menu* button holds all menus.
- **Side panel** (right, resizable, closable) with two tabs like the desktop:
  - **Code preview**: live code of the current diagram, header `Generated by Structorizer 3.32-35 (Web)`;
    the code of the selected element is highlighted, clicking a code line selects its element;
    copy and download buttons; "involve called subroutines".
  - **Arranger index**: all open diagrams grouped into main programs, subroutines (with
    parameter count) and includables; switch, close, new, open; unsaved marker.
- **Several open diagrams** at once; open adds a diagram instead of replacing work.
- **Code export** to Python, Java, JavaScript, C++, PHP and Bash (File › Export › Code,
  favourite language with Ctrl+Shift+X). Written fresh on a tokenizer (no port of the Java
  generators): operators, strings, arrays, built-in functions, INPUT/OUTPUT, declarations
  with types for Java and C++, FOR counter and traversal loops, CASE, REPEAT, TRY, exit,
  leave, throw, disabled elements as comments, called subroutines and includables from the
  other open diagrams.
- **Pictures**: PNG, PNG (multiple, columns × rows tiles), EMF (vector), PDF, SVG; SWF is
  listed like in the desktop but explains that Flash is discontinued. Copy diagram as
  picture (clipboard). **Print** (only the diagram).
- **File menu**: Save all, Open recent file (last 10, kept in this browser), Import of .nsd
  files as new diagrams, Inspect attributes, Clear diagram (delete all), Close diagram.
- **Edit menu**: Find/Replace (text and comments, match case, next/previous, replace, replace all).
- **Diagram menu**: Add before/after submenus, Transmute (split multi-line instructions,
  instruction ⇄ call ⇄ exit, WHILE ⇄ REPEAT), Outsource (element into a new subroutine),
  collapse/expand, type (Main, Sub, Includable), unframed diagram.
- **View menu** (desktop switches): show comments, comments plus texts, switch
  text/comments, highlight variables (desktop colours), operators in C style; zoom.
- **Preferences** dialog: language, appearance (system, light, dark), dark diagram,
  simplified toolbars, confirmation before deleting, favourite export language, parser
  keywords of the diagram and defaults for new diagrams, save/load preferences to/from a
  file, reset, delete all local data.
- **Light and dark mode** for the whole app; the diagram is drawn dark too (switchable),
  exports and prints stay light.
- **Context menu** by right click, or by long press on touch screens (long press and move
  still drags).
- **Key bindings dialog** (Help › Key bindings, Alt+F1) built from the menus; F1 opens the
  user guide, Shift+F1 About.
- **Documentation page** (`docs/`) in the style of the WorkCraft docs: grouped navigation,
  "On this page", 16 articles (getting started, editor, elements, files, pictures, code
  export, Arranger, preferences, keyboard, MCP, privacy, self-hosting, roadmap, licence)
  and the original **Structorizer User Guide 3.32-35 (PDF)** shown in the page.
- **MCP server and CLI** (`main/mcp`, `structorizer-cli mcp`), like the Craft apps:
  tools `list-diagrams`, `read-diagram`, `diagram-info`, `create-diagram`, `add-element`,
  `update-element`, `delete-element`, `move-element`, `export-code`, `export-picture`;
  `--root` limits file access, `--read-only` removes the writing tools. Shares the editor's
  core (file format, layout, code export). End-to-end test with a real MCP client.
- 44 unit tests in the web app (17 new: analysis, expression translation, code generation,
  EMF/PDF structure, highlighting), 11 MCP end-to-end checks.

### Changed
- Version scheme follows the desktop: 3.32-35.
- Autosave keeps all open diagrams (session), not only the current one; 0.1.0 autosaves
  are taken over.
- Toolbar simplified into groups (elements, editing, zoom); undo, redo, save and the panel
  button moved to the top bar.
- Preferences (language, theme, view options ...) are stored together in this browser.

### Fixed
- The .nsd reader no longer depends on `firstElementChild` (works with any DOM implementation).

### Desktop issues addressed in this version
- #1218 (JavaScript generator): new JavaScript export.
- #725 (Python division): `div` becomes `//`, `/` stays `/`.
- #1238 (EXIT to Python): `exit n` becomes `sys.exit(n)`.
- #1232 (`void` result type): recognised as procedure in all generators.
- #1236 (group export duplicates subroutines): every subroutine is emitted once.
- #311, #1016 (menu organisation): desktop menu structure plus a simplified toolbar option.

### Not yet included
- Executor, Turtleizer, breakpoints (shown as "planned" in the Debug menu), Analyser,
  source code import, PWA install. See `info/plan.md`.

## [0.1.0] – 2026-11-18

First basic web version (Phase 0 and 1 of `plan.md`): a working Nassi-Shneiderman
editor that runs completely in the browser and exchanges files with Structorizer Desktop.

### Added
- **Diagram editor** for all 11 element types of Structorizer Desktop: Instruction, Call,
  Exit (Jump), IF, CASE, FOR (counter and traversal), WHILE, REPEAT, endless loop,
  Parallel and TRY (with catch and optional finally).
- Diagram types program, subroutine and includable, with the desktop frame shapes
  (rectangle, rounded corners, two bevelled corners) and the include list box.
- **.nsd files**: open and save in the Structorizer Desktop XML format (version 3.32),
  including keywords, metadata, license info, colours, branch head colours, disabled
  state and FOR loop attributes. Round trip tested with a fixture covering every element
  type and with the desktop sample `hilbert-3.nsd`. Inconsistent CASE elements are
  repaired with a warning instead of failing.
- Layout ported from the desktop drawing code: IF header width and condition placement,
  CASE diagonal with selector labels kept below it (`%` hides the default branch),
  loop bars, Parallel corner marks, TRY sections, comment marks, hatched disabled elements,
  collapsed elements, assignment and comparison operators shown as ←, ≤, ≥, ≠.
- Editing: insert after or before (Shift, or the "insert before" toggle on touch devices),
  element editor with text, comment, the 10 desktop colours and "disabled",
  diagram editor (name/signature, comment, type, frame, author, include list, colour),
  delete, cut, copy, paste, duplicate, move up/down, disable/enable, collapse/expand.
- Undo/redo (100 steps). Inserting and the first edit form one undo step; cancelling the
  editor of a new element removes it again.
- Drag and drop with mouse, and with long press on touch screens; drop indicator; moving
  an element into itself is refused.
- Pinch zoom, zoom buttons (30 to 300 %), "fit to window".
- Desktop keyboard shortcuts: F5 to F12 and Ctrl+F5/F6/F7 insert elements (Shift: before),
  Enter edit, Del delete, Ctrl+↑/↓ move, arrow keys select, Ctrl+7 disable,
  Numpad −/+ collapse, Ctrl+Z/Y, Ctrl+C/X/V, Shift+Del, Shift+Ins, Ctrl+S, Ctrl+O, Ctrl+E.
- Export as SVG and PNG (2x resolution); screen and export use the same renderer.
- Autosave of the current diagram in the browser (`localStorage`), restored on start.
- File System Access API for "Save" on Chromium browsers; download fallback elsewhere
  (Safari, Firefox, iPad).
- Three bundled examples (temperature table, all elements, desktop sample hilbert).
- German and English user interface, switchable, default from the browser language.
- Touch-first layout: 44 px targets, phone and tablet layout, safe areas for iPad/iPhone.
- 27 unit tests (model, .nsd reader/writer, layout, store).

### Privacy and openness
- No server component, no cookies, no analytics, no external fonts or CDNs.
- The production build sets a Content Security Policy with `connect-src 'none'`, so the
  app cannot send data anywhere even by mistake.
- Licensed under GPL-3.0-or-later, like Structorizer Desktop.

### Improvements over desktop issues
- #1244 (iPad / browser version): this project. Runs in Safari on iPad without installation.
- #1243, #1133, #986 (DPI scaling, invisible menu check marks, Look & Feel glitches):
  not applicable, the web UI uses vector graphics and explicit toggle states.
- #401 (dialogs cannot be closed by keyboard): every dialog closes with Esc;
  Shift+Enter or Ctrl+Enter confirms.
- #393 (sample files): example diagrams are bundled in the app.
- #714 (TRY): an empty finally block is hidden by default, as in current desktop versions.
- #1240, #871, #676, #1045, #602 (packaging, installer, package repositories, native
  image, executable scripts): not needed, the app is a static folder that runs in any
  current browser and can be hosted on any web server.
- #311, #1016 (menu organisation): one file menu plus a single toolbar.
- Full review of all listed issues: `docs/issues-review.md`.

### Not yet included (planned, see `plan.md` and `04-roadmap.md`)
- Executor / debugger, Turtleizer, Analyser, code export and import, Arranger,
  multiple open diagrams, find and replace, PWA offline install.
