// ─── mini conf: a key/value language with a nesting region ──────────────────
//
//     # a deployment
//     service api {
//       image "ghcr.io/citisen/api:1.4"
//       replicas 3
//       port 8080
//       health /healthz
//     }
//
// A config format, written to show the three things a rule list can say about position: a key
// is a word at the head of a line, a value is whatever follows it, and a brace opens a block
// that may contain another one. The host table behind the keys is also what makes the
// completion able to say what a KEY's values are, which is the part a word list cannot do.
//
// The playground runs this file and reads three names out of it: `grammar`, `sample`, and
// `options`. Edit any of them and the preview follows.
//
// Things to try:
//
//     put the caret after `port ` and Ctrl+Space  → the rows are the ports
//     accept a row with the space                 → the space commits the row, then lands
//     rename `replicas` to `Replicas`             → the check fires; the key is still offered
//     open a block inside the block               → each `}` closes one level, innermost first
//     delete the final `}`                        → the region is unclosed over its brace

import { defineGrammar, defineVocabulary } from '@citisen/litearea'

/** A key, and the values it will accept, in the order a host wants them offered. */
export const CONF_KEYS = [
  {
    key: 'image',
    detail: 'a container image',
    body: 'A reference, quoted when it carries a tag.',
    values: [],
  },
  {
    key: 'replicas',
    detail: 'how many copies to run',
    body: 'A whole number. Zero takes the service down.',
    values: ['1', '2', '3', '5', '8'],
  },
  {
    key: 'port',
    detail: 'the port inside the container',
    body: 'Where the process listens.',
    values: ['3000', '8080', '9000'],
  },
  {
    key: 'health',
    detail: 'the liveness path',
    body: 'Asked every ten seconds; a failure restarts the container.',
    values: ['/healthz', '/ready', '/'],
  },
  {
    key: 'memory',
    detail: 'the memory ceiling',
    body: 'A number and a unit.',
    values: ['256Mi', '512Mi', '1Gi', '2Gi'],
  },
]

const KEYS = defineVocabulary({
  id: 'conf-key',
  words: CONF_KEYS.map((entry) => entry.key),
  scope: 'key',
  unknownMessage: '"{word}" is not a key — expected {allowed}.',
  unknownCode: 'unknown-key',
  docs: Object.fromEntries(
    CONF_KEYS.map((entry) => [entry.key, { detail: entry.detail, body: entry.body }]),
  ),
})

export const grammar = defineGrammar({
  id: 'mini-conf',
  name: 'mini conf',

  // A key may be written with a dot in it (`cache.ttl`), so the word is not split at the dot
  // and a completion replaces the whole path.
  wordChars: /[A-Za-z0-9_.-]/,

  rules: [
    { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
    { kind: 'match', scope: 'keyword', pattern: /service/, when: { prevNot: '\\w' } },
    { kind: 'match', scope: 'string', pattern: /"(?:[^"\\]|\\.)*"/ },
    { kind: 'match', scope: 'number', pattern: /\d+(?:\.\d+)?/ },
    // A block. `nested` lets a block open inside a block, and `transparent` is what puts this
    // rule list back to work inside one: a region that is neither transparent nor given `rules`
    // of its own swallows its body whole, so every key in the block would be one `block` span
    // and nothing inside it would be a key, a value, or a completion.
    {
      kind: 'region',
      scope: 'block',
      begin: /\{/,
      end: /\}/,
      nested: true,
      transparent: true,
      unclosed: { severity: 'error' },
    },
    // A key is a word at the head of a line. One the table does not know is reported rather
    // than quietly painted as an ordinary word.
    { kind: 'words', words: KEYS, when: { firstOnLine: true }, unknown: {} },
    // Anything else that is not whitespace or a brace is a value.
    { kind: 'match', scope: 'value', pattern: /[^\s{}]+/ },
  ],

  fallbackScope: 'text',

  comments: { line: '#' },

  analyze: (text) => {
    const settings = []
    let offset = 0
    for (const [index, raw] of text.split('\n').entries()) {
      const lineFrom = offset
      offset += raw.length + 1
      const match = /^\s*([\w.-]+)\s+(.+?)\s*$/.exec(raw)
      if (match === null) continue
      const [, key, value] = match
      if (key === undefined || value === undefined) continue
      const from = lineFrom + raw.indexOf(key)
      // Where the key is, so a complaint about it can point at it rather than at the file.
      settings.push({
        key,
        value: value.replace(/^"|"$/g, ''),
        line: index,
        at: { from, to: from + key.length },
      })
    }
    return { settings }
  },

  // A value that is quoted is not checked, and neither is an empty one: this check is about
  // the shape of an unquoted value and nothing else.
  checks: [
    {
      code: 'value-style',
      severity: 'warning',
      scopes: ['key'],
      except: /^[a-z][a-z0-9.-]*$/,
      message: '"{word}" is not a key — lower case, digits, dots, and hyphens.',
    },
  ],

  validate: (context) => {
    const seen = new Set()
    for (const setting of context.state.settings) {
      if (seen.has(setting.key)) {
        context.report({
          from: setting.at.from,
          to: setting.at.to,
          severity: 'info',
          code: 'repeated-key',
          message: `"${setting.key}" is set more than once; the last one wins.`,
        })
      }
      seen.add(setting.key)
    }
  },

  describe: (context) => {
    const token = context.token
    if (token === undefined || token.scope !== 'key') return undefined
    const entry = KEYS.entryFor(token.text)
    if (entry === undefined) return undefined
    const info = { title: token.text }
    if (entry.detail !== undefined) info.detail = entry.detail
    if (entry.body !== undefined) info.body = entry.body
    return info
  },

  compose: [
    {
      id: 'key',
      when: (context) => context.firstWord,
      range: (context) => context.word,
      items: (context) => {
        const used = new Set(context.state.settings.map((setting) => setting.key))
        return CONF_KEYS.map((entry) => ({
          label: entry.key,
          // A space is written after the key and ACCEPTS the row, so the value can be typed
          // without leaving the keyboard. That is what a commit character is for.
          append: ' ',
          commitCharacters: ' ',
          kind: 'key',
          detail: used.has(entry.key) ? 'set already' : entry.detail,
          documentation: entry.body,
          sortText: used.has(entry.key) ? '1' : '0',
        }))
      },
    },
    {
      id: 'value',
      // A value follows a key, and it is the KEY that decides which values are worth offering.
      when: (context) => {
        const line = context.line.number
        const key = context.tokens.find((token) => token.line === line && token.scope === 'key')
        return key !== undefined && key.to <= context.caret && !context.firstWord
      },
      range: (context) => context.word,
      items: (context) => {
        const key = context.tokens.find(
          (token) => token.line === context.line.number && token.scope === 'key',
        )
        const entry = CONF_KEYS.find((candidate) => candidate.key === key?.text)
        if (entry === undefined) return []
        return entry.values.map((value) => ({
          label: value,
          kind: 'value',
          detail: `a ${entry.key} value`,
        }))
      },
    },
  ],
})

/** A document written in it: one service block and the keys inside it. */
export const sample = [
  '# a deployment',
  'service api {',
  '  image "ghcr.io/citisen/api:1.4"',
  '  replicas 3',
  '  port 8080',
  '  health /healthz',
  '}',
  '',
].join('\n')

/** What the editor needs beyond the grammar. This language asks for nothing extra. */
export const options = {}
