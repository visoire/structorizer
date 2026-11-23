# Roadmap – Open & Future Items (Structorizer Web)

This document lists only what is **not yet implemented**. Reference: Structorizer Desktop
3.32-35 (menus in `gui/Menu.java`, generators, parsers, Executor, Analyser, user guide).
State checked against the code of `3.32.35-web.8` on 2026-11-18 (groups line updated for web.10).

Already at desktop level and therefore not listed: all 11 element types, .nsd round trip,
desktop menus and key bindings, Arranger index and board (.arr/.arrz), Executor with step
mode, breakpoints, variable watch, call stack and coverage overlay, Turtleizer, code preview,
picture export (PNG, PNG multiple, EMF, PDF, SVG), find/replace, transmute, content assist,
13 languages, PWA.

Priority: **A** = commonly used in school lessons, **B** = useful, **C** = rarely used / niche.

---

## 1. Executor and language

- [ ] **A – File API**: `fileOpen`, `fileCreate`, `fileAppend`, `fileRead`, `fileReadLine`, `fileReadInt`, `fileReadDouble`, `fileReadChar`, `fileWrite`, `fileWriteLine`, `fileEOF`, `fileClose` (desktop user guide, Syntax). In the browser via a virtual file system kept in local storage, with import/export of the files.
- [ ] **B – Missing built-ins**: `split(string, separator)`, `signum(x)` (alias of `sgn`).
- [ ] **B – Break triggers**: conditional breakpoints that stop only on the n-th pass (desktop "Specify break trigger ...", Ctrl+Alt+B) and "Ignore breakpoints" switch.
- [ ] **B – Runtime analysis modes** like the desktop: execution counts, *step* counts (own and total, including subroutines), logarithmic colour scale, simple vs. deep test coverage; the web version shows counts and one coverage mode.
- [ ] **C – Turtleizer conversion**: Edit › "To fine graphics" / "To integer graphics" (switch `forward`/`fd` between integer and floating point moves).
- [ ] **C – Further diagram controllers**: plug-in interface for controllers besides the Turtleizer (desktop "Optional controllers", proposal #1000 "Karel the Robot").
- [ ] **C – Enum types** (`type Colour = enum{red, green}`), complete with Executor and code export (desktop #739).

## 2. Analyser

- [ ] **A – Remaining Analyser checks**: the desktop has 33 checks (Preferences › Analyser), the web version 9 (A01–A09). Already covered: desktop checks 1 (modified loop variable), 2 (endless loop), 3 (non-initialised variables), 13 (function returns a result), 15 (missing call targets), 22 (constant violations), partly 4 (IF usage) and 14 (FOR parameters). Missing:
  - 7 valid identifiers, 18 names differing only by case, 19 collisions with reserved words, 21 mistakable names «I», «l», «O», 9 program/sub name equal to another identifier
  - 8 assignment in conditions, 10 mixed-type multi-line instructions, 11 assignment errors, 31 declaration/initialisation syntax, 30 balanced brackets
  - 16 incorrect jump usage and unreachable elements, 17 inconsistency risks in parallel sections
  - 20 subroutine header without parameter list, 24 type definitions and record component access
  - 27 / 28 / 29 CASE selectors: integer constants, disjoint lists, no structured choice value
  - 32 collisions with diagram controller routines, 33 pixel-rounding Turtleizer `fd`/`bk`
  - 23 faulty diagram imports
  - 5 / 6 / 12 Luxembourg school conventions (uppercase names, standardised parameter names, optional)
  - 25 / 26 guided tours (IPO model first steps, "hello world" tour)
- [ ] **B – Analyser preferences dialog** with the same check list and on/off switches.

## 3. Code export

- [ ] **B – LaTeX**: StrukTeX (`struktex`) structogram export and the four pseudocode packages of the desktop (`algorithmicx`, `algorithmic`, `algorithm2e`, `pseudocode`).
- [ ] **B – Further languages** of the desktop: Oberon, Perl, KSH, BASIC (with optional line numbers), COBOL, ARM assembler (GNU / Keil).
- [ ] **C – PapDesigner export** (DIN 66001, 1966 and 1982 variants, File › Export › PapDesigner).
- [ ] **B – Export options** (desktop Preferences › Export): instructions as comments, "no conversion of the expression/instruction contents", line numbers, character set, favourite language per file type.
- [ ] **B – Multi-file export**: an Arranger group or `.arrz` as one archive with one source file per diagram.

## 4. Source code import (code → structogram)

The desktop imports with GOLDParser grammars; the web version imports none of these yet.
- [ ] **B – Pascal / Delphi** (File › Import › Pascal Code).
- [ ] **B – C (ANSI C99)**, **Java**, **Processing** (File › Import › Source Code).
- [ ] **C – COBOL**.
- [ ] **C – Foreign NSD editors** (File › Import › Foreign NSD editor file): hus-Struktogrammer (`.stgr`), sbide (`.sbd`), StrukTeX sources.
- [ ] **C – Python import** (not in the desktop either, open request #1225).

## 5. Editor and view

- [ ] **A – Edit subroutine** (Ctrl+Enter on a CALL: open the called diagram or create it with a matching header; on a frame: open an included diagram).
- [ ] **B – Outsource with parameter inference**: the web version moves the element into `sub1()`; the desktop also infers parameters and result variables from the variables used.
- [ ] **B – View › Hide declarations?** and **View › DIN 66261?** (DIN symbol style for FOR loops).
- [ ] **B – Drag and drop of `.nsd` / `.arrz` files** from the file manager onto the window to open them.
- [ ] **B – Print preview** with page setup (orientation, scaling, fit to page) like the desktop print dialog.
- [ ] **C – (Re-)break text lines** (Edit menu: wrap long element texts at a chosen width).
- [ ] **C – Copy vector picture (EMF) to the clipboard** (browsers only allow PNG and text; possible only in a native wrapper).
- [ ] **C – Preferences like the desktop**: custom element colour palette (Colors ...), element names (rename "Instruction", "Call" ...), controller aliases, mouse wheel behaviour, saving options (backups, autosave on execute/close).

## 6. Arranger

- [ ] **B – Arranger groups (rest)**: basic groups exist since web.10 (an .arrz opens as group, assign/rename/dissolve, save group as .arrz, frames on the board). Still missing: a diagram in several groups, group selection and moving on the board, group colours/visibility, congruence checks, Ctrl+G.
- [ ] **B – Dependency arrows** between callers and subroutines/includables on the board.
- [ ] **C – Arranger picture export** (PNG/SVG of the whole board) and print.

## 7. Tools and distribution

- [ ] **C – Translator**: in-app editor for the language files (desktop File › Translator) to contribute translations.
- [ ] **C – Command line batch conversion** like the desktop (`-x` export / `-p` import); the MCP CLI covers code and picture export, import is missing.
- [ ] **B – Signed iPadOS / iOS build (`.ipa`)** from the Capacitor project (`main/web/capacitor.config.json`) with document-in-place editing in the Files app.
- [ ] **C – Optional desktop binary** (Tauri) around `main/web/dist`.

---

## Not planned (desktop-only, not useful in a browser)

- Java Look & Feel, GUI scaling, Windows 11 L&F workaround (the web version scales with the browser and its own zoom).
- "Update ..." / "Notify of new versions" (the hosted page is always current; releases on GitHub).
- SWF export (Flash discontinued since 2020; the menu entry explains this).
