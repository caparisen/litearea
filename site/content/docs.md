# Documentation

litearea is a textarea-based code editor with no runtime dependencies. The engine is pure — text and
a grammar in, tokens and diagnostics out — and the DOM layer puts that behind a real `<textarea>`.

## Install

```sh
npm install @citisen/litearea
```

Three entry points:

| Import | What it is |
| --- | --- |
| `@citisen/litearea` | The engine plus the DOM layer: `createEditor`, `LiteArea` |
| `@citisen/litearea/react` | The React binding: `LiteAreaEditor` |
| `@citisen/litearea/styles.css` | The stylesheet the editor injects, for hosts that link CSS |

## A first editor

```ts
import { createEditor, defineGrammar } from '@citisen/litearea'

const grammar = defineGrammar({
  id: 'greeting',
  rules: [
    { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
    { kind: 'match', scope: 'keyword', pattern: /hello|goodbye/ },
    { kind: 'match', scope: 'name', pattern: /[a-z]+/ },
  ],
})

createEditor(document.querySelector('#editor')!, {
  grammar,
  value: 'hello world  # a comment',
  onChange: (text) => console.log(text),
})
```

A grammar is one object. Rules are tried in order at every position and the first match wins;
`scope` decides the class the characters are painted with, and your CSS decides the colour.

## Reference

- [Grammar](/docs/grammar/) — rule kinds, precedence, vocabularies, diagnostics, decorations, hover.
- [Completion](/docs/completion/) — how the list opens, what a source is asked for, how rows rank.
- [Theming](/docs/theming/) — every custom property, and what must not change.
- [Options and methods](/docs/options/) — every option with its default, and every method.
- [Keys and commands](/docs/keys/) — the keymap as data, and what is left to the browser.
- [Limits](/docs/limits/) — what it does not do, and where the platform decides.

The [API](/api/) is every export by entry point, and the [playground](/playground/) is six complete
languages, each one a file you can edit and run.
