# Structorizer Web – Language Specification (Phase 2)

This specification defines the grammar, operators, types, and built-in routines of the
Structorizer expression and statement language implemented in `main/web/src/core/lang/`
and evaluated by `main/web/src/core/exec/`.

It addresses the open desktop issues identified in `docs/issues-review.md`:
- **#800** (Permanent syntax tree): every element line is parsed into an explicit AST (`Expr`, `StmtNode`) cached by element identity.
- **#980** (Declaration semantics): Pascal (`var a, b: int <- 0`), C (`int a <- 0, b <- 1`), and BASIC (`dim a as int`) declarations with optional initialisers are defined unambiguously.
- **#408** (Executor ignores variable types): runtime values carry type metadata; declared variables enforce or coerce compatible types (`int`, `double`, `bool`, `char`, `string`, `array`, `record`).
- **#530** (String-to-number conversions): explicit conversion built-ins (`strToInt`, `strToDouble`, `strToBool`, `intToStr`, `doubleToStr`) are provided alongside standard Structorizer built-ins.

---

## 1. Lexical Structure (`core/lang/lexer.ts`)

1. **Whitespace & Line Continuation**:
   - Horizontal whitespace separates tokens and is preserved in lossless token streams for syntax highlighting.
   - A trailing backslash `\` at the end of an element text line joins it with the following line before statement parsing (`joinContinuedLines`).
2. **Literals**:
   - **Integer**: decimal (`42`), hexadecimal (`0x2A`), binary (`0b101010`).
   - **Floating-point**: `3.14`, `.5`, `1e-6`, `2.5E+3`.
   - **String / Char**: double-quoted `"hello"` or single-quoted `'a'`, supporting `\"`, `\'`, `\\`, `\n`, `\t`, and doubled quotes `""` inside NSD strings.
   - **Boolean**: `true`, `false` (case-insensitive when `keywords.ignoreCase` is true).
   - **Null**: `null`, `nil`, `None`.
3. **Configurable Keywords**:
   - Stored per diagram (`Diagram.keywords`): `preAlt`, `postAlt`, `preCase`, `postCase`, `preFor`, `postFor`, `stepFor`, `preForIn`, `postForIn`, `preWhile`, `postWhile`, `preRepeat`, `postRepeat`, `preLeave`, `preReturn`, `preExit`, `preThrow`, `input`, `output`, `ignoreCase`.
   - Keywords may consist of multiple words (e.g. `pour chaque`). The keyword-aware lexer matches configured multi-word keywords before splitting identifiers.

---

## 2. Operator Precedence Table (`core/lang/parser.ts` – Pratt Parser)

From lowest to highest binding power:

| Precedence | Operators | Associativity | Meaning |
|---|---|---|---|
| 1 | `\|\|`, `or` | Left | Logical OR (short-circuit) |
| 2 | `^^`, `xor` | Left | Logical / bitwise XOR |
| 3 | `&&`, `and` | Left | Logical AND (short-circuit) |
| 4 | `\|` | Left | Bitwise OR |
| 5 | `^` | Left | Bitwise XOR |
| 6 | `&` | Left | Bitwise AND |
| 7 | `=`, `==`, `<>`, `!=`, `≠` | Left | Equality / Inequality |
| 8 | `<`, `<=`, `≤`, `>`, `>=`, `≥`, `in` | Left | Relational & membership |
| 9 | `<<`, `>>`, `shl`, `shr` | Left | Bit shifts |
| 10 | `+`, `-` | Left | Addition / string concatenation, subtraction |
| 11 | `*`, `/`, `div`, `%`, `mod` | Left | Multiplication, float division, integer division (`div`), modulo |
| 12 (Prefix) | `-`, `+`, `!`, `not`, `~` | Right | Unary negation, logical NOT, bitwise NOT |
| 13 (Postfix) | `f(...)`, `a[i]`, `r.field` | Left | Call, array/string index, record member access |

- **Division (`#725`)**: `/` always performs floating-point division; `div` performs truncated/floor integer division (`Math.trunc(a / b)`).

---

## 3. Statements & Declarations (`#980`, `#408`)

Each logical line in an `Instruction`, `Call`, or `Jump` element parses into a `StmtNode`:

1. **Input**: `<inputKw> ["prompt" [,] ] target1 [, target2 ...]`
   - Reads one value per target (`x`, `a[i]`, `r.f`). Numeric strings are parsed automatically or checked against the target variable's declared type.
2. **Output**: `<outputKw> expr1 [, expr2 ...]`
   - Evaluates all expressions and appends a line to the Executor output console.
3. **Declarations (`#980`, `#408`)**:
   - **Pascal style**: `var a, b: int`, `var x: double <- 1.5`, `const PI <- 3.14159`, `const MAX: int <- 100`.
   - **BASIC style**: `dim a as int`, `dim names as array of string <- {"Ada", "Bob"}`.
   - **C / Java style**: `int x <- 5`, `double[] arr <- {1.0, 2.0}`, `int i, j <- 0`.
   - **Type definitions**: `type Point = record { x: double; y: double }`. Components in Pascal style (`month, day: short`) or C style (`struct { int year; short month, day }`), separated by `;` or line breaks; one definition may span several lines of an instruction.
- **Record initializers**: `Date{year: 2026, month: 11, day: 23}`, the C form `Date{.year = 2026}` and the "smart" form `Date{2026, 11, 23}` (values fill the components in declaration order; after the first named component further unnamed values are ignored and not evaluated). `x = 5` inside braces is a comparison, never a component name. A declared record variable (`var d: Date`) accepts `d <- {2026, 11, 23}`. Unknown types or components are runtime errors; component values are converted to the declared type.
4. **Assignment**: `target <- expr` or `target := expr` (also `target += expr`, `-=`, `*=`, `/=`, `target++`, `target--`).
   - `target` is an identifier `x`, indexed lvalue `a[i][j]`, or record field `p.x`.
5. **Routine Call**: `name(arg1, arg2, ...)`
   - Includes built-in procedures (`inc(x[, delta])`, `dec(x[, delta])`, `insert`, `delete`, `randomize`, and Turtleizer commands).
6. **Jumps**:
   - `leave [n]`: exits `n` enclosing loops (default `1`). Cannot cross a `parallel` section boundary.
   - `return [expr]`: exits the current diagram and returns `expr` (or the Pascal result variable if assigned).
   - `exit [code]`: terminates the entire program execution with exit code `code`.
   - `throw [expr]`: raises a runtime exception caught by an enclosing `Try` element.

---

## 4. Built-in Functions & Procedures (`#530`)

### 4.1 Mathematical
- `abs(x)`, `sgn(x)`, `sqrt(x)`, `sqr(x)`, `pow(x, y)`, `exp(x)`, `log(x)`
- `sin(x)`, `cos(x)`, `tan(x)`, `asin(x)`, `acos(x)`, `atan(x)`, `toRadians(deg)`, `toDegrees(rad)`
- `floor(x)`, `ceil(x)`, `round(x)`, `min(a, b, ...)`, `max(a, b, ...)`
- `random(bound)`, `randomize()`
- `inc(var[, delta])`, `dec(var[, delta])`

### 4.2 Strings, Arrays & Conversions (`#530`)
- `length(sOrArr)`: character count of a string or element count of an array.
- `lowercase(s)`, `uppercase(s)`, `trim(s)`
- `pos(sub, s)`: 1-based index of `sub` in `s` (`0` if not found, matching Pascal/Structorizer semantics).
- `copy(s, start, count)`: substring starting at 1-based `start` of length `count`.
- `ord(ch)`, `chr(code)`
- `strToInt(s[, default])`, `strToDouble(s[, default])`, `strToBool(s)`
- `intToStr(n)`, `doubleToStr(x)`
- `isArray(v)`, `isChar(v)`, `isBool(v)`, `isNumber(v)`, `isString(v)`

### 4.3 Turtleizer Controller Routines
- Movement: `forward(px[, color])`, `fd(px[, color])`, `backward(px[, color])`, `bk(px[, color])`
- Rotation: `left(deg)`, `rl(deg)`, `right(deg)`, `rr(deg)`
- Pen & Canvas: `penUp()`, `up()`, `penDown()`, `down()`, `gotoXY(x, y)`, `gotoX(x)`, `gotoY(y)`, `hideTurtle()`, `showTurtle()`, `clear()`, `setPenColor(r, g, b)`, `setBackgroundColor(r, g, b)`, `setBackground(r, g, b)`
- Queries: `getX()`, `getY()`, `getOrientation()`
