# Structorizer Web – Executor & Debugger Specification (Phase 2)

This specification defines the execution state machine, runtime environments, multi-diagram
routine resolution, runtime analysis overlay, Turtleizer controller, and debugger UI in
`main/web/src/core/exec/`, `main/web/src/store/execStore.ts`, and `main/web/src/ui/`.

---

## 1. Architecture & State Machine (`core/exec/executor.ts`)

Per Decision **D-14**, the executor is a pure JavaScript generator (`function*`) with
**zero `eval` and zero `new Function`**.

```ts
export type ExecYield =
  | { t: 'step'; elementId: string; diagramId: string; kind: ElementKind }
  | { t: 'input'; elementId: string; prompt: string; target: string }
  | { t: 'output'; elementId: string; text: string }
  | { t: 'error'; elementId: string; message: string }
  | { t: 'done'; returnValue?: Value; exitCode?: number };
```

### 1.1 Execution Lifecycle
1. **Before each enabled element**:
   - Yields `{ t: 'step', elementId, diagramId, kind }`.
   - Increments `execCounts.get(elementId)` and marks `covered.add(elementId)` for the runtime analysis overlay (**P2-09**).
   - If `breakpoints.has(elementId)` or the UI is in `step` mode, the controller pauses before advancing the generator.
2. **Input Handling**:
   - When an `INPUT` statement runs, the generator yields `{ t: 'input', elementId, prompt, target }`.
   - The UI displays an input prompt (or reads from a queued input list) and resumes the generator with `gen.next(userProvidedString)`.
3. **Subroutine Resolution (`P2-08`)**:
   - When a `Call` element or expression calls `fn(a1, ..., ak)` and `fn` is not a built-in:
     - Searches the diagram pool (`pool: Diagram[]`) for a `sub` diagram whose parsed signature name matches `fn` (honouring `ignoreCase`) and whose parameter count accepts `k` arguments (`minRequired <= k <= params.length`).
     - Pushes a new `StackFrame` (`{ diagramId, name, vars, resultVar }`) onto `callStack`, binds arguments (and default parameter values), runs the subroutine's `includeList` if not yet initialized, and yields steps inside the subroutine.
     - When `return expr` runs or the subroutine body finishes, pops the frame and returns the result value (from `return expr`, `result` / `RESULT` / `<fnName>` variable, or `null`).
4. **Structured Elements**:
   - **Alternative**: evaluates condition; executes `thenBranch` if truthy, else `elseBranch`.
   - **Case**: evaluates discriminator; tests each branch's selector list in order; executes matching branch or default branch (unless default selector is `%`).
   - **For**:
     - `COUNTER`: initializes `counterVar <- startValue`; loops while `(step >= 0 ? counter <= end : counter >= end)`, incrementing by `stepConst` after each pass.
     - `TRAVERSAL`: evaluates `list` (array or string) and iterates `counterVar` over each item.
   - **While / Forever**: pre-test / endless loop.
   - **Repeat**: post-test loop (`body` runs at least once until exit condition is truthy).
   - **Parallel**: creates an independent generator per branch (`branches.map(b => execSeq(b))`), puts non-finished branch element IDs in `waitingIds` (`#ffffd2`), and steps a randomly chosen active branch until all complete. Refuses `leave` across the parallel boundary.
   - **Try**: runs `tryBody`; on `throw` or runtime error, binds message to catch variable (`text[0] || 'ex'`) and runs `catchBody`; always runs `finallyBody` afterwards.

---

## 2. Debugger & Control Panel UI (`P2-06`, `P2-07`, `P2-09`)

1. **Control Bar**:
   - **Run / Resume** (`F5` in executor or Play button), **Step** (Next element), **Pause**, **Stop / Reset**, and **Speed slider** (`0 ms` fast batch up to `1500 ms` per step).
   - **Breakpoints**: toggle on any element (`Ctrl+B`, context menu, or clicking the breakpoint toggle in the debugger); rendered as a red bar along the top edge of the element box in `DiagramView`.
2. **Diagram Overlays (`DiagramView.tsx`)**:
   - **Running element**: orange highlight (`#ffa500` fill / outline).
   - **Waiting parallel elements**: soft yellow (`#ffffd2`).
   - **Runtime analysis & coverage (`P2-09`)**: when enabled, covered elements show a soft green coverage tint and their execution count badge (`×N`) at the top-right corner of the element head (for REPEAT at its condition). Like the desktop's "Collect Run Data", the counts add up over several runs while Coverage is on; **Reset** (Executor bar and Debug menu) clears them, switching Coverage on or off starts clean. Loop heads (WHILE, REPEAT, FOREVER, FOR) count every pass.
- **OUTPUT and stepping (web.11)**: the `output` event of an OUTPUT element is consumed inside the same advance, so Step, Run, Pause and INPUT always stop on the next element; Resume does not skip a breakpoint on the following element.
3. **Live Variable Watch (`P2-07`)**:
   - Displays all variables in the active stack frame with their type and formatted value.
   - **Editable while paused**: double-clicking or editing a value cell in the watch table updates the variable in the live frame immediately.
4. **Call Stack & Output Console**:
   - Shows the active call stack frames (`main -> hilbert(10, 3, 1) -> ...`); clicking a frame switches the displayed diagram to inspect it.
   - Console displays all `OUTPUT` lines, runtime errors (clicking an error selects the offending element), and an inline `INPUT` prompt when waiting for user input.
5. **Turtleizer Canvas (`Turtleizer.tsx`)**:
   - Canvas-based turtle graphics controller supporting all Structorizer `Turtleizer` routines, zoom/pan, clear, and SVG/PNG export.
