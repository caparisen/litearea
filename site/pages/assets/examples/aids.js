// ─── aids: delimiters and comment markers the grammar declares ──────────────
//
//     {
//       name: "workbench",
//       size: 12,
//       # ctrl+/ toggles these markers
//       tags: [alpha, beta]
//     }
//
// The two things here are OPTIONAL FIELDS on the grammar and not options on the editor, and
// that is a language decision rather than an API one: only the language knows that a paren
// inside a comment is prose and a paren inside an expression is a bracket. `indentSize` is a
// taste, so it lives on the editor; this is a fact about the syntax, so it lives beside the
// rules.
//
// Every edit the editor makes from these declarations goes through the browser's own editing
// pipeline, so one Ctrl+Z takes back both characters of an auto-closed pair and every marker of
// a multi-line comment toggle.
//
// The playground runs this file and reads three names out of it: `grammar`, `sample`, and
// `options`. Edit any of them and the preview follows.
//
// Things to try:
//
//     type `{`, `[`, `(` or `"`                 → the pair closes itself, caret between
//     select `alpha, beta` and type `(`         → the selection is wrapped and stays selected
//     Enter between the braces of an empty pair → `{\n  \n}`, caret on the indented line
//     then press `Ctrl+/` twice                 → the markers go on and then come back off
//     select three lines and press `Ctrl+]`     → all three indent as one edit, and one Ctrl+Z
//                                                 takes it back

import { defineGrammar } from '@citisen/litearea'

/** The typing-aids language: the pairs that close, and the markers `Ctrl+/` toggles. */
export const grammar = defineGrammar({
  id: 'aids',
  name: 'data',

  rules: [
    { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
    { kind: 'match', scope: 'string', pattern: /"(?:[^"\\]|\\.)*"/ },
    { kind: 'match', scope: 'keyword', pattern: /true|false|null/, when: { prevNot: '\\w' } },
    { kind: 'match', scope: 'number', pattern: /-?\d+(?:\.\d+)?/ },
    { kind: 'match', scope: 'name', pattern: /[A-Za-z_][\w-]*/ },
    { kind: 'match', scope: 'punctuation', pattern: /[{}()[\],:]/ },
  ],

  fallbackScope: 'text',

  // Typing any of these writes the closer and leaves the caret between the two. The quote is
  // refused inside a string or a comment, where it is a quotation mark and not a delimiter —
  // which is the argument for `pairs` being the language's: the editor cannot know that.
  pairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"', notIn: ['string', 'comment'] },
  ],

  comments: { line: '#', block: ['/*', '*/'] },
})

/** A document written in it: a string, a nested list, and a marker for `Ctrl+/`. */
export const sample = [
  '{',
  '  name: "workbench",',
  '  size: 12,',
  '  # ctrl+/ toggles these markers',
  '  tags: [alpha, beta]',
  '}',
  '',
].join('\n')

/**
 * What the editor needs beyond the grammar.
 *
 * `indent.unit` is a taste and lives on the editor rather than on the language, because two
 * hosts may read the same file with different ones. `keys` binds the block indent to `Mod+]`
 * and the block outdent to `Mod+[`.
 *
 * Tab is deliberately NOT bound: it is how a reader leaves a form, and an editor that takes it
 * turns every field into a keyboard trap. Two lines give it back:
 *
 *     { key: 'Tab', command: 'indent' },
 *     { key: 'Shift+Tab', command: 'outdent' },
 */
export const options = {
  indent: { unit: 2 },
  keys: [
    { key: 'Mod+]', command: 'indentLines' },
    { key: 'Mod+[', command: 'outdentLines' },
  ],
}
