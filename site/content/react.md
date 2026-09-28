# React

`LiteAreaEditor` mounts one editor and renders one empty `div` for it to live in. It is the only
export of `@citisen/litearea/react`, and `react >= 18` is an optional peer dependency: nothing in the
engine or the DOM layer imports React.

```tsx
import { LiteAreaEditor } from '@citisen/litearea/react'

<LiteAreaEditor grammar={grammar} defaultValue="hello world" onChange={setText} />
```

## Props

| Prop | What it does |
| --- | --- |
| `grammar` | The language. Re-read on every render |
| `defaultValue` | The starting text, written once when the editor mounts |
| `value` | For a host that wants to write the text itself |
| `preserveHistory` | Whether that write is one undoable edit or an assignment that clears the history |
| `readOnly` | Re-read on every render |
| `editorRef` | Handed the editor once it exists |
| `className` | An extra class on the wrapper |

Every option `createEditor` takes is also a prop — `sizing`, `completion`, `hover`, `sticky`,
`indent`, `keys`, `decorations`, `injectStyles`, `styleNonce`, `variables` — plus the callbacks.

## What is read when

Three props are re-read on every render: `grammar`, `value`, and `readOnly`. The grammar is the one
that is safe to rebuild on every render, because `refresh()` re-resolves it without rebuilding the
element.

Everything else is read when the editor mounts. Changing `sizing`, `completion`, `hover`, `sticky`,
`indent`, `keys`, `decorations`, `injectStyles`, or `styleNonce` later re-renders the wrapper and
nothing else.

## The text never passes through React

Assigning a textarea's `value` is what clears the browser's undo history and resets the caret, so
React never writes it. `defaultValue` is the prop for the starting text, `value` is for a host that
wants to write one, and `onChange` reports the reader's edits rather than a render.
