# Architecture

Why litearea is shaped the way it is. The README says what it does; this says what
each decision costs and what it was chosen over.

The tree the editor builds:

```
div.litearea            ← the positioning container, and editor.element
  div.litearea-box      ← the border, the radius, and the focus ring
    div.litearea-layer  ← the painted text, behind and inert
    textarea            ← the real field: transparent text, visible caret
  div.litearea-popup    ← the completion list
  div.litearea-tooltip  ← the hover tooltip
```

The layer is inside the box while the two floating elements are outside it, so the box's
rounded border cannot cut off the bottom of a list.

## The one-parse rule

`inspect(text, grammar)` produces the tokens, the diagnostics, the decorations, and
the analysis together, as one value. Everything downstream reads that value and
nothing re-derives it:

| Reader | What it takes from the inspection |
| --- | --- |
| The layer | `tokens`, `decorations`, `diagnostics` and the text |
| The completion list | `tokens`, `diagnostics`, `state`, and the document text |
| The tooltip | `tokens`, `diagnostics`, `decorations`, `state` |
| `onDiagnostics` | `diagnostics` |
| `onAccept` | `state` |

The editor caches it on the text: `sync()` re-inspects only when
`input.value` differs from the text the last inspection was computed from, so
moving the caret, scrolling, or hovering costs nothing beyond the paint. The paint
carries a key of its own (the revision, whether decorations are painted, and the
decoration and diagnostic counts), and `Overlay.render` returns immediately when
both the text and the key match the last call, so a caret move does not rebuild
every span on the page.

The completion list and the coloured text cannot disagree, because there is only one
answer.

The same idea reaches into the DOM layer: `buildSegments` takes the three range
lists and produces one stream, `complete` takes an inspection and produces rows,
and `resolveHover` takes an inspection and produces a tooltip. None of them read
the document again.

### One pass per language

A composite document does not get a second scan of the outer text. `scan` finds every
`grammar` region in its single left-to-right pass, records it in `ScanResult.embeds`
(the region's content is opaque to the outer rules, so it is one span found in one
search), and `inspect` then runs the nested grammar over
`text.slice(contentFrom, contentTo)` and splices the result into place:

- every token is shifted by `contentFrom` and re-addressed to its line and column in the
  outer document. The outer span for the region's content is removed first, so the
  embedded paint replaces it rather than doubling it, and a token that only partly
  overlaps the span is clipped rather than dropped;
- every diagnostic and decoration is shifted by the same amount, and the language spans
  themselves are shifted and one level deeper.

The recursion is depth-uniform: each call's offsets are relative to the text it was
given, so a child answers in its own coordinates and its caller shifts once. A region
three languages deep is shifted once per level on the way out. `LanguageSpan.depth` is
the one number adjusted on the way in, by adding the enclosing depth to each child
span.

The outer grammar's `checks` and `validate` run before the splice, over the outer tokens
alone: a check is a statement about this language's words.

## Why the textarea is uncontrolled

A textarea owns its own undo stack, and that stack is maintained by the browser's
editing pipeline — not by the `value` property. Assigning `field.value` replaces
the text and destroys the history, and it resets the caret to the end. So the
editor never writes `value` for an edit the user could have made:

```ts
field.setSelectionRange(from, to)
document.execCommand('insertText', false, text)   // ← undoable
```

Three details in that path matter:

- **The field is focused first**, because the pipeline only runs on the focused
  element, and a completion accepted by mouse click arrives after the click has
  blurred the field.
- **The return value is not trusted.** It differs across browsers; the *value*
  decides. `field.value !== before` tells the two paths apart: a change the editor did
  not make itself is a change the browser's history already knows about.
- **Only the changed range is written.** A completion writes `insert` over
  `[from, to)` and then moves the selection with `setSelectionRange`, which
  touches no text and cannot disturb the history.

`execCommand` is deprecated and has no replacement. A synthetic `beforeinput` or
`InputEvent` is untrusted, so the browser refuses to run it through the editing
pipeline, and `setRangeText` changes the text while bypassing the history entirely.

Where it is missing, the edit still happens: `replaceThroughPipeline` falls back to
`setRangeText`, dispatches the `input` event the browser would have dispatched, and
returns `'direct'` instead of `'pipeline'`, so the caller knows the history did not get
the edit. `canEditThroughPipeline()` reports which environment you are in,
`EditOutcome` is `'pipeline' | 'direct' | 'unchanged'`, and `setValue(next,
preserveHistory)` is the one place that assigns `value` outright, for loading a
different document.

`undoField` and `redoField` are thin wrappers over `execCommand('undo'/'redo')`.
They report only whether the call was possible, never whether anything was
actually undone, because no browser exposes that.

## Layer alignment

The painted layer draws the same characters as the field, behind it and inert
(`aria-hidden`, `pointer-events: none`, `user-select: none`), and the field's own
text is transparent with a visible caret. The two elements must not disagree about
where a glyph goes:

**One typography, shared.** `.litearea-layer` and `.litearea-input` share a single
rule, and the mirror copies the same computed properties. Adding a text property
to one of them and not the other is the only way to break the stylesheet.

**The layer may change three things.** Colour, background, and `text-decoration`.
Anything that changes an advance (another font, a weight, letter spacing, a font
feature) slides the paint off the character it belongs to. The box therefore declares
one monospace face and refuses ligatures: a ligature draws one glyph in the layer where
the field draws two, so every character after it would be painted in the wrong place.

**The scrollbar is compensated, not ignored.** When the box is clamped to its maximum
height the field grows a scrollbar, which narrows the text; a layer at the full width
would wrap differently and every colour would slide off its character. The field's
measured scrollbar width is published as `--litearea-scrollbar` and added to the
layer's right padding. It is read *after* the overflow is applied, because that is when
a scrollbar exists and there is a width to report.

**Wrapping is not maintained by positioning.** `buildSegments` collects every range
boundary (every token edge, decoration edge, and diagnostic edge) as a cut point, then
emits one segment per interval, merging neighbours whose presentation is identical. The
renderer appends those spans back to back with no positioning: the characters lay out
where the characters lay out, and the colours follow. The alternative, three overlay
layers one per range list, does not work: each would need its own idea of where a range
starts, and a span positioned by measuring drifts as soon as the font, the wrapping, or
the padding differs from what was measured.

One segment shows one squiggle: the loudest diagnostic covering it wins, so two
underlines do not stack. The layer is scrolled by copying the field's
`scrollTop`/`scrollLeft` rather than by a transform, which can leave text on a half
pixel.

**A document ending in a newline has one more line than the paint.** A textarea lays
out the empty line after that newline, which the reader can put the caret on, and a
`pre-wrap` div does not, because the newline breaks the line and nothing follows it.
`min-height: 100%` covers only the case where the content fits inside the box; when it
overflows the field scrolls one line further than the text and the caret appears to walk
away from the word under it. The paint therefore earns that line with a trailing `<br>`,
an element rather than a character, which keeps `paint.textContent === field.value` true
while the last line box exists. The scrollbar case has a second half of the same kind: a
field with a scrollbar of its own wraps in a narrower space, and that width is measured
and published in the resizable mode too, because it is still a width the paint has to
wrap inside.

Both are asserted in `scripts/browser-check.mjs` by scrolling three editors to the
bottom (one document ending in a newline, one not, and one whose field owns its own
scrollbar) and comparing the offsets, the scrollable heights, and the wrapping widths.
Neither is visible to a unit test, because `happy-dom` lays nothing out.

**A rect is not a rect.** Two misalignments come from reading the wrong rectangle
rather than from wrapping or fonts:

- An inline box's `getBoundingClientRect` reports the font's CONTENT area, not the LINE
  box it sits in, about 15px against 20px, with the leading split above and below. Both
  places that report a caret's box therefore return the line box, correcting by half the
  leading: `mirror.caretBox`, whose documented contract said line box while the
  implementation used the content box, which is how the inline preview ended up two
  pixels low on an empty line, and `PaintReader.lineBox`. A popup below the caret does
  not care, but a chip of text that has to line up with the text beside it does.
- Absolutely positioned children are offset from their containing block's **padding
  box**, not its border box, and the box has a one pixel border. The sticky rows and the
  inline preview are both children of it, so both were a pixel low until
  `paddingBoxOf` made the correction a call rather than a comment.

**Everything that has to sit ON the paint is measured FROM the paint.** Where a line
landed is `dom/paint.ts`'s question, a `Range` over the line's characters, one walk of
the painted text nodes, cached until the paint changes, and both the pinned rows and the
inline preview ask it. The mirror is for the field: it predicts the caret, which is what
a popup below the caret wants and what a chip that must continue the painted word does
not. The one case the paint cannot answer is a line with nothing painted on it, and
there the mirror still stands.

## The mirror

Two measurements are needed and the field cannot supply either:

- **How tall the content is.** A textarea can report `scrollHeight`, but not
  while its own height is being changed: asking for it means collapsing the
  element first, which reflows the page and makes the box flicker on every
  keystroke.
- **Where the caret is.** A textarea has no API for it at all.

So a second element is kept offscreen with the field's exact typography and box,
and the question is asked of it. One mirror serves both jobs, because both are
measurements of text with the same copied styles. It uses `visibility: hidden` rather
than `display: none`, because a hidden element still lays out and a removed one does
not.

**The property list is exhaustive**, not "the ones that seemed to matter": font
family, size, weight, style, stretch, variant ligatures, kerning, feature settings,
line height, letter spacing, word spacing, text transform, indent, align, direction,
tab size, white space, overflow wrap, word break, hyphens, padding, border widths and
styles, and box sizing. A missing `letter-spacing` moves the caret a fraction of a
character per character, so the popup drifts further off the longer the line is.

The width has to be the field's **content** width or text wraps in one and not the
other. The field's `clientWidth` is its content plus padding but *not* its border, while
the mirror is `border-box`, so the borders are added back. The scrollbar is left out: a
field clamped to its maximum height has one, and its text wraps inside the narrower area
above it.

**The line height is measured, not assumed.** `line-height: normal` is a real and
common value and cannot be parsed as a number, so one line of text is laid out and
its height taken; a font that reports nothing usable falls back to 1.2 × the font
size.

**The trailing-newline sentinel.** A `white-space: pre-wrap` element whose content ends
in `\n` does not lay out a final empty line, because the newline breaks the line and
nothing follows it, so the measured height comes back one line short and the box grows a
scrollbar when the user presses Enter at the end. A zero-width space after the newline
gives that last line something to be.

**The caret marker technique.** To find the caret, the mirror is rebuilt with the text
before the caret as a text node, the character *after* the caret inside a `white-space:
pre` span, and the rest after it. Everything before the caret lays out normally, so the
marker lands where the next glyph will be. A span that could wrap would let the marker
jump to the next line on its own, which is wrong at a line end. At the end of the
document a zero-width space stands in for the next character. The field's own scroll
offsets are then subtracted, because the caret's position on screen is what the popup is
placed against, and a scrolled field moves its text without moving its border box. The
mirror is rebuilt rather than patched: it is offscreen, so measuring it is cheap, while
keeping incremental DOM in step with a fast typist is not.

**The unmounted trap.** An element that is not in the document has no layout, so its
width is zero, the mirror wraps at every character, and the measurement comes back
several times too tall. An unmounted field is therefore skipped rather than measured
(`!isConnected || clientWidth === 0`), a `ResizeObserver` installed at construction
performs the first real measurement as soon as there is a width to measure against, and
`createEditor` re-measures synchronously after mounting so the first frame is already
right. A web font arriving later changes every metric the mirror copied, so
`document.fonts.ready` triggers one refresh when it lands; without it the editor is a few
pixels off until something else causes a re-layout.

## Auto-sizing

The decision procedure, in the order it runs:

1. With `autoGrow: false`, only adopt the mirror and return. Caret geometry still
   needs the mirror to be shaped like the field even when the height is the host's
   business; the stylesheet gives the field `resize: vertical`.
2. `chrome` is the vertical padding plus the vertical borders, which every height
   includes; `lineHeight` comes from the mirror.
3. `minPx = max(minHeight ?? 0, lineHeight × minRows + chrome)` — the floor is
   whichever of the two is larger.
4. `maxCandidate = min(maxHeight ?? ∞, maxRows ? lineHeight × maxRows + chrome : ∞)`,
   then `maxPx = max(maxCandidate, minPx)`. A maximum below the minimum is a host
   mistake.
5. `content = mirror.contentHeight(field, text)` — the height the text wants with
   the full width available, and no scrollbar to narrow it.
6. `wanted = clamp(max(content, minPx), minPx, maxPx)`; `overflow` becomes `'auto'`
   when the content exceeds what was granted by more than half a pixel, and
   `'hidden'` otherwise.
7. Write the height only when it moved by more than half a pixel, write
   `overflow-y` only when it changed, and then read the scrollbar width (now that
   one may exist) and publish it.

The mirror has no scrollbar, so step 5 is the number that decides whether a scrollbar is
needed. **Wrapping has to agree with the layer**: the
decision to clamp claims that the text fits the width the layer will be given, so the
width the mirror measures at, the width the field wraps at, and the width the layer
wraps at are the same, including the scrollbar compensation above. `minRows` is also
written to the textarea's native `rows` attribute, so the box has the right height on
the first frame, before any measurement, and in a document where the script never runs.

## Pure engine, thin DOM

`src/core/` imports nothing from `src/dom/`, and nothing in it touches the DOM. Text
and a grammar go in, values come out:

| Testable in plain Node | Needs a browser |
| --- | --- |
| `scan` / `inspect`: the paint, the diagnostics, the decorations, the analysis | Whether an edit is undoable |
| `complete` / `applyCompletion`: eligibility, source stability, the recomputed range, ranking, the edit | Where the caret ends up after an edit |
| `rank`, `fuzzyMatch`, `highlightSegments` | Whether the layer and the field really line up |
| `buildSegments`: the merge order | Whether the box has a scrollbar |
| `resolveHover` and the precedence | Anything about font metrics, wrapping, or scrollbar widths |
| `defineVocabulary`, `lineStarts`, `wordInfoAt`, `tokenAt`, `lineIndexAt` | |
| `buildStickyBlocks`, `planStickyHeaders`: which blocks nest, and which header has scrolled out of sight | Where a pinned row lands, and whether a `Range` over one line reports a box at all |
| `applyCompletion`: what a row writes, which the inline preview and the accept read from the same call | Where the inline preview lands, since that is the caret's geometry |
| `planPairTyping`, `planBracketEnter`, `planCommentToggle`: what a keystroke, an Enter, and a comment toggle should do to the text | Whether the resulting edit is one undoable edit — every one of them is applied through the browser's pipeline, and only a real history can say |
| `planIndent`: what a level of indentation does to a caret or to a block of lines | The same claim again, and the one it is easiest to get wrong: a five-line indent is one edit, so one Ctrl+Z takes it back |
| `resolveCommand`, `matchesKey`, `keyCombo`: which command a chord asks for, and whether it matches at all | Whether the keystroke was actually taken from the browser, since a key the editor did not cancel is a key the page still gets |
| `PaintReader`'s arithmetic: which line a caret is on, and which end of a range answers a caret | The rectangles themselves — an inline box against a line box, a padding box against a border box — which is where the two misalignments it was written for actually lived |

Everything in the left column has a decision in it, and a decision is what a unit
test asserts; everything in the right column is a fact about a renderer. That is why
`scripts/browser-check.mjs` exists: a textarea's undo stack has no API to read and no way
to fake, so the only honest test is to make an edit and undo it in a browser that has a
real one.

The harness bundles the **shipped** `dist/index.js`, the package's one JavaScript entry
point, rather than `src/`, so what it drives is the artifact a host installs, and it
inlines it as an IIFE, because Chromium refuses to fetch an ES module from a `file://`
URL. The language the checks run against is defined inside the checklist itself, since
the package ships none and a product DSL belongs beside the plugin that owns it. It
drives the public API and the public DOM only: it mounts editors, types through
`execCommand('insertText')`, presses keys, dispatches a `mousedown` on a row, and hovers
a squiggle. The page reports through `document.title`, with `error` and
`unhandledrejection` listeners writing to the same channel, so a syntax error in the
bundle does not show up as an unchanged title with no evidence. The browser's stdout is
written to files rather than read through a pipe, because it cannot be captured through
piped stdio in a confined environment and comes back empty in a way that looks like the
page produced no output.

The **negative control** is the part of that harness worth copying. Before it
tests that a completion can be undone, it asserts that a direct `value` assignment
is **not** undoable:

```js
control.value = 'abc'
control.focus()
control.value = 'abcd'
document.execCommand('undo')
// control.value must still be 'abcd'
```

Without it, a passing undo test would only show that `execCommand('undo')` returned
true. The check skips cleanly, with exit 0, when no Chromium-based browser is present;
`LITEAREA_REQUIRE=1` turns the skip into a failure.

The DOM layer is thin: `LiteArea` is the only class that holds state, and every other
module in `src/dom/` is one job: `editing` the undo-preserving write, `mirror` the
measurement, `overlay` the paint, `popup` the list, `tooltip` the hover, `sticky` the
pinned header rows, `support` the one place that asks the environment a question.
`createEditor(target, options)` is the class plus "append it and measure again".

## What was rejected

| Rejected | Why |
| --- | --- |
| A controlled component (state → `value` → re-render) | This is the bug the library exists to fix: assigning `value` clears the undo history and resets the caret, and re-rendering text to reposition the caret is a race the browser wins. A grammar worth writing is worth keeping the browser's undo stack for |
| `contenteditable` | It makes the document a DOM tree that the browser edits in ways you do not control — nested elements, `<br>` for a blank line, pasted HTML — so the value would have to be re-serialised on every keystroke, which is the same re-render problem with more failure modes and no native undo semantics worth having |
| A second highlighting layer per range list (one for scopes, one for decorations, one for squiggles) | Each layer would have to position its own spans, so each would need its own idea of where a range starts, and a span positioned by measuring drifts as soon as the font, the wrapping, or the padding is even slightly different from what was measured. One merged stream cannot drift because nothing is positioned |
| Measuring the live field (`scrollHeight` after collapsing it) | It reflows the page and flickers on every keystroke — the measurement that is supposed to decide the height is what makes the height unstable. The offscreen mirror pays one extra layout and keeps the field's geometry out of the question |
| A bundled grammar (a default language, or a language registry) | The claim of the library is that the core knows no syntax. A default grammar would make that claim false, and it would be the thing every host inherited. The package therefore ships no grammar at all: a DSL lives beside the plugin that owns it and is handed to the editor as a value |
| Synthetic `beforeinput`/`InputEvent` edits | Untrusted, so the browser will not run them through the editing pipeline: the text changes and the history does not, which is worse than a documented `'direct'` fallback because it fails silently |
| Tracking the caret as a character index in one module and a screen position in another | Every position that crosses a module boundary is a character offset; pixels enter only in `src/dom/`, only to place a floating element, and never travel back inward. Two coordinate systems for one caret is what produced the range that "had already moved" |
