# A code editor over a plain `<textarea>`.

litearea reads a string and a grammar and puts the result behind a real textarea: highlighting,
squiggles, a completion list, and hover, with the browser's own undo stack intact. No runtime
dependencies, and no grammar shipped.

The library does not own the text. The textarea owns it, the browser's editing pipeline edits it,
and litearea only reads it. That is why undo survives an accepted completion, why the caret never
jumps mid-word, and why the colours cannot disagree with the field they are painted over.

```sh
npm install @citisen/litearea
```

## What it does

| Feature | How |
| --- | --- |
| Undo and redo | The browser's own history on the field. Every edit litearea makes goes through `execCommand('insertText')`, so one edit is one Ctrl+Z |
| Highlighting | `rules` paint scopes. A scope becomes the class `litearea-scope-<scope>` and your stylesheet decides the rest |
| Completion | Sources over a range recomputed from the caret, tiered fuzzy ranking, a documentation panel, commit characters |
| Diagnostics | Vocabulary rejections, declarative `checks`, and a `validate` hook, merged into four severities |
| Hover | A diagnostic outranks everything; otherwise the decoration's title and the grammar's `describe` |
| Typing aids | Declared `pairs` close themselves and wrap a selection; `Ctrl+/` toggles comments |
| Sticky headers | Decoration kinds named by `sticky.kinds` are blocks, and the header you are inside is pinned to the top of the box |
| Auto-sizing | An offscreen mirror is measured rather than the live field |
| Weight | No runtime dependencies, no CodeMirror, no Monaco, no virtual DOM in the engine |

## What it is not

No line numbers, no search, no multiple cursors, no bracket matching, no folding, no snippets. There
is no bundled language: a caller supplies the rules, and the six [examples](/examples/) are six
grammars written for this site rather than six that ship with the package.
[Limits](/docs/limits/) lists the rest, including the places where the platform decides for the
library.

## Start here

- [Documentation](/docs/) — install, a first editor, and the reference.
- [Examples](/examples/) — six languages, each running live on its own page.
- [Playground](/playground/) — write a grammar and watch the parse.
