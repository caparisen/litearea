# Examples

Six complete languages — rules, vocabularies, diagnostics, completion, hover — each running live on
its own page. None of them is in the package.

- [Swatch](/examples/swatch/) — a vocabulary the host supplies rather than the file.
- [Form schema](/examples/form-schema/) — typed rows, a note region, and a declarative check.
- [Mini conf](/examples/mini-conf/) — a nesting region and a completion that reads the key before the caret.
- [Sticky headers](/examples/sticky/) — blocks that nest, pinned one row per level.
- [Typing aids](/examples/typing-aids/) — pairs that close themselves and a comment toggle.
- [Completion](/examples/completion/) — tiered ranking, a documentation panel, an inline preview.

Each page quotes the code it runs, from the file it runs it from. Here is that editor in the flow of
a page rather than pinned beside it:

::: live swatch label=swatch
:::

The readout under a live editor comes from the editor's own callbacks — `onDiagnostics`,
`onCompletion`, `onChange` — rather than from a second parse of the text.

## Why no grammar ships with it

A grammar belongs where the language is parsed. The two production DSLs this editor came out of live
beside the plugins that own them, as objects those plugins hand to `createEditor`.

Shipping one would be a scaling trap as much as an inconsistency: every consumer that inlines the
library would carry every language, so adding a JavaScript grammar later would grow the bundle of
every host that uses none of them.
