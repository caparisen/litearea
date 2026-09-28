// ─── swatch: a palette language with a vocabulary the file owns ─────────────
//
//     red circle 20        ; in this palette, so no complaint
//     mauve circle 20      ; also in this palette
//     teal blob 40         ; not a shape: one squiggle
//
// The palette lives OUTSIDE the document, and that is the point of the language: `red` is a
// swatch here and a mistake in an application whose palette does not have it. In an application
// the list arrives from the host; in this file it is the constant below, which is what makes
// editing it change the editor beside the code.
//
// The colour a palette paints first is a DECORATION rather than a token, and the difference is
// the whole argument for the two: a token is what the characters are and does not change when
// the host's data does; a decoration is recomputed and can.
//
// Nothing here is built in. The library ships no syntax, and this file is the whole of the
// language.
//
// The playground runs this file and reads three names out of it: `grammar`, `sample`, and
// `options`. Edit any of them and the preview follows.
//
// Things to try:
//
//     remove `mauve` from PALETTE, then type `mauve circle 20` → one diagnostic
//     type `teal blob 40`                                      → `blob` is not a shape
//     Ctrl+Space at the head of an empty line                  → the colours, in order
//     accept a colour, then Ctrl+Space again                   → the shapes
//     type a colour on a second line                           → the second coat is reported
//     hover `rounded`                                          → the vocabulary's own entry

import { defineGrammar, defineVocabulary } from '@citisen/litearea'

/** The colours this host knows, in the order it wants them offered. */
const PALETTE = ['red', 'amber', 'teal', 'mauve', 'bone', 'ink']

/** The colour this host paints first, the one it calls the base coat. */
const BASE_COAT = 'red'

/** The shapes this language knows. */
export const SHAPES = ['circle', 'square', 'rounded', 'bar']

// The word sets live OUTSIDE the document, which is the form the library calls once per scan
// and the reason the grammar needs no mutable state of its own.
const COLORS = defineVocabulary({
  id: 'swatch-color',
  words: () => PALETTE,
  scope: 'swatch.color',
  unknownMessage: '"{word}" is not in this palette — expected {allowed}.',
  unknownCode: 'unknown-color',
})

const SHAPE_WORDS = defineVocabulary({
  id: 'swatch-shape',
  words: SHAPES,
  scope: 'swatch.shape',
  unknownMessage: '"{word}" is not a shape — expected {allowed}.',
  unknownCode: 'unknown-shape',
  docs: {
    circle: { detail: 'a disc', body: 'The roundest shape this language has.' },
    square: { detail: 'four corners', body: 'Sharp corners, straight edges.' },
    rounded: { detail: 'a rounded box', body: 'A square whose corners were taken off.' },
    bar: { detail: 'a full-width stripe', body: 'Used as a rule rather than as a mark.' },
  },
})

/** A line's words, located, with any comment removed. */
function wordsOf(raw, lineFrom) {
  const hash = raw.indexOf('#')
  const body = hash === -1 ? raw : raw.slice(0, hash)
  const words = []
  const pattern = /[A-Za-z][A-Za-z0-9-]*|\d+/g
  let match
  while ((match = pattern.exec(body)) !== null) {
    const from = lineFrom + match.index
    words.push({ text: match[0], from, to: from + match[0].length })
  }
  return words
}

export const grammar = defineGrammar({
  id: 'swatch',
  name: 'swatch',

  // A hyphen belongs to a colour name here (`off-white`), so a completion has to replace the
  // whole name rather than half of it.
  wordChars: /[A-Za-z0-9-]/,

  rules: [
    { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
    // A digit is a word character, so this rule has to come before the vocabularies or the size
    // would be claimed by one of them and complained about.
    { kind: 'match', scope: 'number', pattern: /\d+/ },
    { kind: 'words', words: COLORS, when: { firstOnLine: true }, unknown: {} },
    { kind: 'words', words: SHAPE_WORDS, unknown: {} },
  ],

  fallbackScope: 'text',

  // ── what the document means ───────────────────────────────────────────────
  //
  // One pass, and every later hook reads its result. Whether a line is a swatch at all is
  // decided here once, so the paint, the diagnostics, and the decoration cannot disagree.
  analyze: (text) => {
    const entries = []
    const problems = []
    const seen = new Set()
    const rows = text.split('\n')
    let offset = 0

    for (let index = 0; index < rows.length; index += 1) {
      const raw = rows[index] ?? ''
      const lineFrom = offset
      offset += raw.length + 1
      const words = wordsOf(raw, lineFrom)
      if (words.length === 0) continue

      const [color, shape, size] = words
      if (color === undefined || shape === undefined || size === undefined) {
        problems.push({
          from: lineFrom,
          to: lineFrom + raw.length,
          severity: 'warning',
          code: 'incomplete-swatch',
          message: 'A swatch is a colour, a shape, and a size.',
          source: 'swatch',
        })
        continue
      }

      entries.push({
        color: color.text,
        shape: shape.text,
        size: Number(size.text),
        from: color.from,
        line: index,
      })
      if (seen.has(color.text)) {
        problems.push({
          from: color.from,
          to: color.to,
          severity: 'warning',
          code: 'repeated-color',
          message: `"${color.text}" is painted twice; the second coat wins.`,
          source: 'swatch',
        })
      }
      seen.add(color.text)

      // The colour names are the vocabulary's business. The number is this half's, because a
      // word set cannot say anything about a value.
      if (Number(size.text) <= 0) {
        problems.push({
          from: size.from,
          to: size.to,
          severity: 'info',
          code: 'empty-swatch',
          message: 'A swatch with no size paints nothing.',
          source: 'swatch',
        })
      }
    }

    return { entries, problems }
  },

  validate: (context) => {
    for (const problem of context.state.problems) {
      context.report({
        from: problem.from,
        to: problem.to,
        message: problem.message,
        severity: problem.severity,
        code: problem.code,
      })
    }
  },

  // ── what a thing is ───────────────────────────────────────────────────────
  describe: (context) => {
    const token = context.token
    if (token === undefined) return undefined
    const entry =
      token.scope === 'swatch.color'
        ? COLORS.entryFor(token.text)
        : SHAPE_WORDS.entryFor(token.text)
    const info = { title: token.text, detail: token.scope }
    if (entry?.detail !== undefined) info.detail = entry.detail
    if (entry?.body !== undefined) info.body = entry.body
    return info
  },

  // ── what can come next ────────────────────────────────────────────────────
  compose: [
    {
      id: 'color',
      // `firstWord` and not `firstOnLine`: the list has to stay eligible while the colour is
      // being spelled, and by then the line has content.
      when: (context) => context.firstWord,
      range: (context) => context.word,
      items: (context) => {
        const used = new Set(context.state.entries.map((entry) => entry.color))
        return PALETTE.map((color) => ({
          label: color,
          append: ' ',
          kind: 'color',
          detail: used.has(color) ? 'already in this file' : 'from the palette above',
          // A colour the file has not used yet is offered first. That is what a sort key is
          // for: the label does not have to start with a zero to be ranked above another.
          sortText: used.has(color) ? '1' : '0',
        }))
      },
    },
    {
      id: 'shape',
      // A shape follows a colour. The higher priority is what lets this source take over from
      // the colour source: both are eligible while the line is one word, and the colour list
      // would otherwise keep answering because it is declared first.
      priority: 1,
      when: (context) => {
        if (context.firstWord || context.line.before.trim() === '') return false
        const line = context.line.number
        return !context.tokens.some(
          (token) =>
            token.line === line && token.scope === 'swatch.shape' && token.to <= context.caret,
        )
      },
      range: (context) => context.word,
      items: () =>
        SHAPES.map((shape) => ({
          label: shape,
          append: ' ',
          kind: 'shape',
          detail: SHAPE_WORDS.entryFor(shape)?.detail,
          documentation: SHAPE_WORDS.entryFor(shape)?.body,
        })),
    },
  ],

  // ── what is semantically true, rather than what the characters are ──────
  decorate: (_text, state) => {
    const entry = state.entries.find((candidate) => candidate.color === BASE_COAT)
    if (entry === undefined) return []
    return [
      {
        from: entry.from,
        to: entry.from + entry.color.length,
        kind: 'base-coat',
        title: `base coat: ${entry.color}`,
      },
    ]
  },
})

/** A document written in it: three swatches, and one word that is not a shape. */
export const sample = [
  '# a palette, a shape, and a size',
  'red circle 20',
  'teal square 40',
  'mauve blob 12',
  '',
].join('\n')

/** What the editor needs beyond the grammar. This language asks for nothing extra. */
export const options = {}
