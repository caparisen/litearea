// ─── plan: two kinds of block, nested ───────────────────────────────────────
//
//     group alpha
//       step one 10
//       step two 20
//
// A language whose whole point is that its blocks nest, so that the editor can pin more than
// one header while the reader is inside both. A `group` runs until the next group; a `step`
// runs until the next step or the next group.
//
// The blocks are DECORATIONS rather than a second declaration. A grammar already has exactly
// one place to say what a block is — the ranges `decorate` returns — and a separate list would
// be a second answer to the same question, which the two would disagree about the first time
// the language changed.
//
// The playground runs this file and reads three names out of it: `grammar`, `sample`, and
// `options`. Edit any of them and the preview follows.
//
// Things to try:
//
//     scroll inside the box                     → the pinned row changes as you cross groups
//     click into the text while a row is pinned → the caret still lands where you clicked
//     caret in the last group, arrow down       → the header unpins exactly when the block's
//                                                 last line leaves the top

import { defineGrammar } from '@citisen/litearea'

/** Where each line begins. */
function lineStarts(text) {
  const starts = [0]
  for (let at = 0; at < text.length; at += 1) {
    if (text.charCodeAt(at) === 10) starts.push(at + 1)
  }
  return starts
}

/**
 * One range per block.
 *
 * A real language would compute this from its own analysis; here the rule is stated in terms of
 * the lines themselves, so what the page shows is the SHAPE of the document rather than a
 * parser. That is also why a grammar shipping this much logic in `decorate` is honest: the work
 * is proportional to the document, not to the text, and it is recomputed without re-lexing.
 *
 * @param text - the document.
 * @returns the ranges, parents before children.
 */
function blocksOf(text) {
  const starts = lineStarts(text)

  /**
   * The lines whose first word is `word`.
   *
   * Indentation is not part of the rule, and that is the correction this file needed: the
   * sample below indents a step inside its group, and the first version of this compared the
   * line from its first character, so a step was never a block and nothing nested. A block here
   * is a word at the head of a line, whatever the line is indented by — which is also why the
   * ranges are what the document SHAPE is rather than what a parser recovered.
   *
   * @param word - `group` or `step`.
   * @returns the line numbers of the heads.
   */
  const headsOf = (word) =>
    starts
      .map((_, line) => line)
      .filter((line) => {
        const start = starts[line] ?? 0
        const end = text.indexOf('\n', start)
        const whole = text.slice(start, end === -1 ? text.length : end)
        return whole.trimStart().startsWith(`${word} `)
      })

  const groups = headsOf('group')
  const steps = headsOf('step')
  const ranges = []

  groups.forEach((line, index) => {
    const next = groups[index + 1]
    ranges.push({
      kind: 'block',
      from: starts[line] ?? 0,
      to: next === undefined ? text.length : (starts[next] ?? text.length) - 1,
    })
  })

  // A step ends at whichever comes first, the next step or the group it is in — which is what
  // keeps a step's range inside its group's range, and what makes the pinned rows stack in the
  // order the document nests rather than in the order they were declared.
  steps.forEach((line) => {
    const after = [...steps, ...groups]
      .map((other) => starts[other] ?? text.length)
      .filter((start) => start > (starts[line] ?? 0))
    const next = after.length === 0 ? undefined : Math.min(...after)
    ranges.push({
      kind: 'block',
      from: starts[line] ?? 0,
      to: next === undefined ? text.length : next - 1,
    })
  })

  return ranges
}

/** The plan language: two kinds of block, nested, with the header of the current one pinned. */
export const grammar = defineGrammar({
  id: 'plan',
  name: 'plan',

  rules: [
    { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
    { kind: 'match', scope: 'keyword', pattern: /group|step/, when: { prevNot: '\\w' } },
    { kind: 'match', scope: 'number', pattern: /\d+/ },
    { kind: 'match', scope: 'name', pattern: /[a-z][\w-]*/ },
  ],

  fallbackScope: 'text',
  comments: { line: '#' },

  // The header line of the block the caret is inside is copied to the top of the box while the
  // reader is in it, one row per level of nesting. Nothing here says how that is drawn: the
  // ranges say what a block is, and `sticky.kinds` says which blocks are worth pinning.
  decorate: (text) => blocksOf(text),
})

/** The groups the sample is built from, and the steps inside each of them. */
const GROUPS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta']
const STEPS = ['one', 'two', 'three', 'four', 'five', 'six']

/**
 * A document written in it, long enough that the box has to scroll — which is the whole point
 * of the language: a pinned header is only visible while the block it belongs to is leaving the
 * top of the box. It is BUILT rather than written out, because fifty lines of `step` in a file
 * about ranges would bury the ranges.
 */
export const sample = [
  '# a plan, long enough that the box has to scroll',
  ...GROUPS.flatMap((group, at) => [
    `group ${group}`,
    ...STEPS.map((step, index) => `  step ${step} ${String(at * STEPS.length + index + 1)}`),
  ]),
].join('\n')

/**
 * What the editor needs beyond the grammar.
 *
 * `sticky.kinds` names the decoration kinds that are blocks, so a language says what a block is
 * in exactly one place: the ranges `decorate` already returns. `sticky` is off unless it is
 * passed, and a pinned row is a copy of the painted line, so the header keeps its colours.
 *
 * `completion: false` turns the list off: this grammar declares no `compose` sources, so there
 * is nothing for a list to offer and no reason for one to open.
 */
export const options = { completion: false, sticky: { kinds: ['block'] } }
