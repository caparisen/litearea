// ─── composite: one Markdown document, four embedded languages ───────────────
//
// The demo's third grammar, and the one that shows what a region can now be. A fenced
// block is not tinted one colour: its content is handed to a language of its own, which
// brings its own rules, its own diagnostics, its own completion, its own hover, and its
// own comment markers with it. Everything that follows the caret — the word a completion
// replaces, the pair a keystroke closes, the marker `Ctrl+/` writes — follows it in.
//
//     ```json
//     { "name": "litearea" }        ← JSON strings, JSON keys, a duplicate-key warning
//     ```
//
//     ```html
//     <script>const x = 1</script>  ← HTML, with JavaScript embedded in the HTML
//     ```
//
// Nothing here is built into the library either. Every grammar in this file is a grammar
// a host would write, and they nest four deep: Markdown holds a fence, the fence holds
// HTML, and the HTML holds JavaScript or CSS. Each one is inspected over its own text, so
// a JSON `analyze` never sees Markdown and a CSS check never sees a tag.

import type { Grammar, Token } from '@citisen/litearea'
import { defineGrammar, defineVocabulary } from '@citisen/litearea'

// ── JSON ────────────────────────────────────────────────────────────────────

/** The words JSON has, declared once so the paint, the message, and the docs agree. */
const JSON_LITERALS = defineVocabulary({
  id: 'json-literal',
  words: ['true', 'false', 'null'],
  scope: 'json.literal',
  unknownMessage: '"{word}" is not a JSON value — expected {allowed}.',
  docs: {
    true: { detail: 'the boolean true', body: 'Written lower case, always: JSON has no `True`.' },
    false: { detail: 'the boolean false' },
    null: { detail: 'the absence of a value' },
  },
})

/**
 * JSON: the first embedded language.
 *
 * It is a complete grammar rather than a token tint, because that is the point of
 * embedding one: a string that never closes is reported INSIDE the fence, a duplicate key
 * is a warning about the region the reader is in, and completion inside the block offers
 * the literals and the keys the document already uses.
 */
export const jsonGrammar = defineGrammar({
  id: 'json',
  name: 'JSON',
  wordChars: /[\p{L}\p{N}_$]/u,
  rules: [
    // The comment is not JSON either, and that is the point: an embedded language may be
    // stricter or looser than the standard, and this one is the reader's, not the spec's.
    { kind: 'match', scope: 'json.comment', pattern: /\/\/[^\n]*/ },
    // A quoted name followed by a colon is a KEY. It is declared above the string region
    // because a key and a string are the same characters and the reader wants to see them
    // differently — the first rule that matches wins, so the narrower one goes first.
    { kind: 'match', scope: 'json.key', pattern: /"(?:[^"\\]|\\.)*"(?=\s*:)/ },
    {
      kind: 'region',
      scope: 'json.string',
      begin: /"/,
      end: /"/,
      // Without this, `"a \"b\""` is three tokens and a false diagnostic. Escaping is
      // counted, so `"a\\"` is still one string that ends where it looks like it ends.
      escapes: '\\',
      openScope: 'json.punctuation',
      closeScope: 'json.punctuation',
      contentScope: 'json.string',
      unclosed: { message: 'This string is never closed.', code: 'unclosed-string' },
    },
    { kind: 'match', scope: 'json.number', pattern: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/ },
    { kind: 'words', words: JSON_LITERALS, unknown: {} },
    { kind: 'match', scope: 'json.punctuation', pattern: /[{}[\],:]/ },
    { kind: 'match', scope: 'json.invalid', pattern: /\S/ },
  ],
  fallbackScope: 'json.space',

  validate: (context) => {
    // One entry per open object, innermost last, so a name is only a duplicate within the
    // level it was written at. The walk reads the TOKENS, which is what a validator is for:
    // the shape of the document is already known by the time it runs.
    const levels: Array<Map<string, Token>> = []
    for (const token of context.tokens) {
      if (token.scope === 'json.punctuation') {
        if (token.text === '{') levels.push(new Map())
        else if (token.text === '}') levels.pop()
        continue
      }
      if (token.scope !== 'json.key') continue
      const level = levels[levels.length - 1]
      if (level === undefined) continue
      const name = token.text.slice(1, -1)
      if (level.has(name)) {
        context.report({
          from: token.from,
          to: token.to,
          severity: 'warning',
          code: 'duplicate-key',
          message: `"${name}" is already set in this object, so this one wins.`,
          detail: 'JSON readers keep the last one. The first is what a human meant.',
        })
        continue
      }
      level.set(name, token)
    }
  },

  compose: [
    {
      id: 'json-value',
      range: (context) => context.word,
      items: (context) => {
        const used = new Set(
          context.tokens.filter((token) => token.scope === 'json.key').map((token) => token.text),
        )
        return [
          ...JSON_LITERALS.resolve({ text: context.text, state: context.state }).map((word) => ({
            label: word,
            kind: 'json-literal',
            detail: 'a JSON literal',
            documentation: JSON_LITERALS.entryFor(word)?.body,
          })),
          // A document-wide source beside a vocabulary: every key already written is worth
          // offering, and it sorts below the three words the language itself has.
          ...[...used].map((key) => ({
            label: key,
            kind: 'json-key',
            sortText: '1',
            detail: 'a key already in this document',
          })),
        ]
      },
    },
  ],

  describe: (context) => {
    const token = context.token
    if (token === undefined) return undefined
    if (token.scope === 'json.key' || token.scope === 'json.string') {
      return {
        title: token.text,
        detail: 'a JSON string',
        body: 'Double quotes only. A backslash escapes the character after it.',
      }
    }
    const entry = JSON_LITERALS.entryFor(token.text)
    return entry === undefined ? undefined : { title: token.text, detail: entry.detail, body: entry.body }
  },

  pairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '"', close: '"', notIn: ['json.string', 'json.key'] },
  ],
  comments: { line: '//' },
})

// ── JavaScript ──────────────────────────────────────────────────────────────

/** The words this JavaScript grammar paints as keywords. */
const JS_KEYWORDS = defineVocabulary({
  id: 'js-keyword',
  words: [
    'async',
    'await',
    'class',
    'const',
    'default',
    'else',
    'export',
    'for',
    'from',
    'function',
    'if',
    'import',
    'let',
    'new',
    'return',
    'while',
  ],
  scope: 'js.keyword',
  docs: {
    const: { detail: 'a binding that cannot be reassigned' },
    function: { detail: 'a declaration', body: 'Hoisted, unlike a `const` holding an arrow.' },
    return: { detail: 'leaves the function' },
  },
})

/**
 * JavaScript: the language the HTML region embeds, and the fence embeds directly.
 *
 * Three string shapes, two comment shapes, and a snippet that leaves the caret inside the
 * parentheses it writes — enough that a reader can feel the difference between a tinted
 * block and a language.
 */
export const scriptGrammar = defineGrammar({
  id: 'javascript',
  name: 'JavaScript',
  wordChars: /[\p{L}\p{N}_$]/u,
  rules: [
    {
      kind: 'region',
      scope: 'js.comment.block',
      begin: /\/\*/,
      end: /\*\//,
      // A JavaScript block comment does not nest, and `nested` is left off on purpose: the
      // inner open delimiter is prose, and the first close delimiter ends the comment.
      openScope: 'js.comment',
      closeScope: 'js.comment',
      contentScope: 'js.comment',
      unclosed: { message: 'This block comment is never closed.', code: 'unclosed-comment' },
    },
    { kind: 'match', scope: 'js.comment', pattern: /\/\/[^\n]*/ },
    {
      kind: 'region',
      scope: 'js.template',
      begin: /`/,
      end: /`/,
      escapes: '\\',
      // The delimiters carry the punctuation scope rather than the content's: adjacent tokens
      // with the same scope MERGE, so a quote painted as a string would come out as one token
      // with the body it opens, and the body's own colour would start a character late.
      openScope: 'js.punctuation',
      closeScope: 'js.punctuation',
      contentScope: 'js.template',
      unclosed: { message: 'This template literal is never closed.', code: 'unclosed-template' },
    },
    {
      kind: 'region',
      scope: 'js.string.single',
      begin: /'/,
      end: /'/,
      escapes: '\\',
      openScope: 'js.punctuation',
      closeScope: 'js.punctuation',
      contentScope: 'js.string',
      unclosed: { severity: 'warning', code: 'unclosed-string' },
    },
    {
      kind: 'region',
      scope: 'js.string.double',
      begin: /"/,
      end: /"/,
      escapes: '\\',
      openScope: 'js.punctuation',
      closeScope: 'js.punctuation',
      contentScope: 'js.string',
      unclosed: { severity: 'warning', code: 'unclosed-string' },
    },
    { kind: 'match', scope: 'js.number', pattern: /\d+(?:\.\d+)?/ },
    { kind: 'words', words: JS_KEYWORDS, when: { prevNot: '\\w' } },
    { kind: 'match', scope: 'js.function', pattern: /[A-Za-z_$][\w$]*(?=\s*\()/ },
    { kind: 'match', scope: 'js.identifier', pattern: /[A-Za-z_$][\w$]*/ },
    { kind: 'match', scope: 'js.punctuation', pattern: /[{}()[\];,.]/ },
    { kind: 'match', scope: 'js.operator', pattern: /=>|===|!==|==|!=|&&|\|\||[+\-*/%<>=!&|?:]/ },
  ],
  fallbackScope: 'js.space',

  compose: [
    {
      id: 'js-keyword',
      range: (context) => context.word,
      items: (context) =>
        JS_KEYWORDS.resolve({ text: context.text, state: context.state }).map((word) => ({
          label: word,
          kind: 'js-keyword',
          append: ' ',
          detail: 'a keyword',
          documentation: JS_KEYWORDS.entryFor(word)?.body,
        })),
    },
    {
      id: 'js-snippet',
      when: (context) => context.firstWord,
      range: (context) => context.word,
      items: () => [
        {
          label: 'console.log()',
          insert: 'console.log()',
          kind: 'js-snippet',
          caretOffset: -1,
          detail: 'a snippet',
        },
      ],
    },
  ],

  describe: (context) => {
    const token = context.token
    if (token === undefined) return undefined
    const entry = JS_KEYWORDS.entryFor(token.text)
    if (entry !== undefined) return { title: token.text, detail: entry.detail, body: entry.body }
    if (token.scope.startsWith('js.string') || token.scope === 'js.template') {
      return { title: token.text, detail: 'a string', body: 'A template literal may hold `${…}`.' }
    }
    if (token.scope === 'js.comment') return { title: 'comment', body: 'Ignored by the engine.' }
    return undefined
  },

  pairs: [
    { open: '{', close: '}' },
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: "'", close: "'", notIn: ['js.string', 'js.comment', 'js.template'] },
    { open: '"', close: '"', notIn: ['js.string', 'js.comment', 'js.template'] },
  ],
  comments: { line: '//', block: ['/*', '*/'] },
})

// ── CSS ─────────────────────────────────────────────────────────────────────

/** The properties this stylesheet grammar knows. A word outside it is reported. */
const CSS_PROPERTIES = defineVocabulary({
  id: 'css-property',
  words: [
    'align-items',
    'background',
    'border',
    'color',
    'display',
    'flex',
    'font-family',
    'font-size',
    'gap',
    'grid-template-columns',
    'margin',
    'padding',
    'position',
    'width',
  ],
  scope: 'css.property',
  docs: {
    display: { detail: 'how the box behaves', body: '`flex` and `grid` are the two this demo uses.' },
    color: { detail: 'the text colour' },
  },
})

/**
 * CSS: the third embedded language, and the one that shows a `checks` running inside a
 * fence — `colour` is not a property, and the squiggle that says so arrives from the CSS
 * grammar rather than from the Markdown around it.
 */
export const styleGrammar = defineGrammar({
  id: 'css',
  name: 'CSS',
  wordChars: /[\p{L}\p{N}_-]/u,
  rules: [
    { kind: 'region', scope: 'css.comment', begin: /\/\*/, end: /\*\//, unclosed: { severity: 'warning', code: 'unclosed-comment' } },
    {
      kind: 'region',
      scope: 'css.block',
      begin: /\{/,
      end: /\}/,
      // The interior is code, not prose: the property rules below apply inside the braces.
      transparent: true,
      openScope: 'css.punctuation',
      closeScope: 'css.punctuation',
      contentScope: 'css.text',
      unclosed: { message: 'This block is never closed.', code: 'unclosed-block' },
    },
    {
      kind: 'region',
      scope: 'css.string',
      begin: /"/,
      end: /"/,
      escapes: '\\',
      openScope: 'css.punctuation',
      closeScope: 'css.punctuation',
      contentScope: 'css.string',
    },
    { kind: 'match', scope: 'css.at-rule', pattern: /@[\w-]+/ },
    { kind: 'match', scope: 'css.property', pattern: /[a-z-]+(?=\s*:)/ },
    { kind: 'match', scope: 'css.value.color', pattern: /#[0-9a-fA-F]{3,8}\b/ },
    { kind: 'match', scope: 'css.number', pattern: /-?\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms)?/ },
    { kind: 'match', scope: 'css.function', pattern: /[a-zA-Z-]+(?=\()/ },
    { kind: 'match', scope: 'css.selector', pattern: /[.#][\w-]+|::?[\w-]+|\*|\[[^\]]*\]/ },
    { kind: 'match', scope: 'css.punctuation', pattern: /[{}:;,()]/ },
    { kind: 'match', scope: 'css.word', pattern: /[a-zA-Z-]+/ },
  ],
  fallbackScope: 'css.space',
  checks: [
    {
      code: 'unknown-property',
      scopes: ['css.property'],
      allow: CSS_PROPERTIES,
      severity: 'warning',
      message: '"{word}" is not a property this stylesheet knows — expected {allowed}.',
    },
  ],
  compose: [
    {
      id: 'css-property',
      range: (context) => context.word,
      items: (context) =>
        CSS_PROPERTIES.resolve({ text: context.text, state: context.state }).map((property) => ({
          label: property,
          kind: 'css-property',
          append: ': ',
          detail: 'a property',
          documentation: CSS_PROPERTIES.entryFor(property)?.body,
        })),
    },
  ],
  describe: (context) => {
    const token = context.token
    if (token === undefined) return undefined
    const entry = CSS_PROPERTIES.entryFor(token.text)
    return entry === undefined ? undefined : { title: token.text, detail: entry.detail, body: entry.body }
  },
  pairs: [
    { open: '{', close: '}' },
    { open: '(', close: ')' },
  ],
  comments: { block: ['/*', '*/'] },
})

// ── HTML ────────────────────────────────────────────────────────────────────

/**
 * A tag stack over the raw text, for the diagnostics the lexer cannot produce.
 *
 * This is the honest division of labour in a flat lexer: the PAINT of an HTML file is a
 * sequence of tag names, attribute names, and attribute values, and a regular expression
 * is the right tool for it. What a regular expression cannot do is say which `</div>` a
 * `<div>` belongs to, because that is a fact about a stack — so the stack lives here, in
 * `validate`, where the tokens and the text are both available and the engine expects a
 * grammar to do its own structural thinking.
 * @param context - the grammar's validator context, for the text and for `report`.
 */
function checkTagNesting(context: {
  text: string
  report: (problem: {
    from: number
    to: number
    message: string
    severity?: 'error' | 'warning' | 'info' | 'hint'
    code?: string
  }) => void
}): void {
  const VOID = ['area', 'br', 'col', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']
  const stack: Array<{ name: string; from: number; to: number }> = []
  const pattern = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(context.text)) !== null) {
    const raw = match[0]
    const closing = match[1]
    const name = (match[2] ?? '').toLowerCase()
    const selfClosing = match[4] === '/'
    if (selfClosing || VOID.includes(name)) continue
    if (closing === '') {
      stack.push({ name, from: match.index, to: match.index + raw.length })
      continue
    }
    const open = stack.pop()
    if (open === undefined) {
      context.report({
        from: match.index,
        to: match.index + raw.length,
        severity: 'error',
        code: 'tag-no-open',
        message: `</${name}> closes nothing.`,
      })
      continue
    }
    if (open.name !== name) {
      context.report({
        from: match.index,
        to: match.index + raw.length,
        severity: 'error',
        code: 'tag-mismatch',
        message: `</${name}> closes <${open.name}>, which opened here.`,
      })
    }
  }
  for (const open of stack) {
    context.report({
      from: open.from,
      to: open.to,
      severity: 'error',
      code: 'tag-unclosed',
      message: `<${open.name}> is never closed.`,
    })
  }
}

/**
 * HTML, which embeds JavaScript and CSS.
 *
 * The regions are what make this the second level of the nesting: `<script>` hands its
 * content to `scriptGrammar` and `<style>` hands its content to `styleGrammar`, so the
 * paint inside them, the completion inside them, and the comment markers inside them all
 * belong to those languages. The attributes are painted by position — a name after a tag
 * name is an attribute name, a value after an equals sign is a value — because a flat
 * lexer has no other way to know it is inside a tag.
 * @returns the grammar.
 */
export function markupGrammar(): Grammar {
  return defineGrammar({
    id: 'html',
    name: 'HTML',
    wordChars: /[\p{L}\p{N}_:-]/u,
    rules: [
      { kind: 'region', scope: 'html.comment', begin: /<!--/, end: /-->/, unclosed: { message: 'This comment is never closed.', code: 'unclosed-comment', severity: 'warning' } },
      {
        kind: 'region',
        scope: 'html.script',
        begin: /<script[^>]*>/i,
        end: /<\/script[ \t]*>/i,
        openScope: 'html.tag.punct',
        closeScope: 'html.tag.punct',
        contentScope: 'html.script',
        grammar: scriptGrammar,
        unclosed: { message: 'This script is never closed.', code: 'unclosed-script' },
      },
      {
        kind: 'region',
        scope: 'html.style',
        begin: /<style[^>]*>/i,
        end: /<\/style[ \t]*>/i,
        openScope: 'html.tag.punct',
        closeScope: 'html.tag.punct',
        contentScope: 'html.style',
        grammar: styleGrammar,
        unclosed: { message: 'This stylesheet is never closed.', code: 'unclosed-style' },
      },
      {
        kind: 'region',
        scope: 'html.attr.value',
        begin: /"/,
        end: /"/,
        openScope: 'html.quote',
        closeScope: 'html.quote',
        contentScope: 'html.attr.value',
        // A value follows an equals sign, and the quote before another attribute name is
        // what tells the two apart — `class="a" id="b"` chains through the closing quote.
        when: { after: ['html.attr.equals', 'html.attr.name', 'html.quote'] },
        unclosed: { message: 'This attribute value is never closed.', code: 'unclosed-attribute', severity: 'warning' },
      },
      { kind: 'match', scope: 'html.tag.punct', pattern: /<\// },
      { kind: 'match', scope: 'html.tag.punct', pattern: /</ },
      // A tag name follows the bracket that opens a tag — and the closing bracket has a scope
      // of its own, or `after: ['html.tag.punct']` would still hold after `>` and every word
      // of the element's text would be read as another tag name.
      { kind: 'match', scope: 'html.tag.name', pattern: /[a-zA-Z][\w-]*/, when: { after: ['html.tag.punct'] } },
      { kind: 'match', scope: 'html.tag.end', pattern: /\/?>/ },
      { kind: 'match', scope: 'html.attr.equals', pattern: /=/, when: { after: ['html.attr.name', 'html.quote'] } },
      { kind: 'match', scope: 'html.attr.name', pattern: /[a-zA-Z_:][\w:.-]*/, when: { after: ['html.tag.name', 'html.attr.name', 'html.quote'] } },
      { kind: 'match', scope: 'html.entity', pattern: /&[a-zA-Z#0-9]+;/ },
      // Text is what follows a tag's closing bracket, what follows an entity, or what opens a
      // line. The guards exist because an unguarded text rule would eat a tag's attributes: a
      // greedy match from the space after `<div` reaches past `class="card"` and takes it all.
      { kind: 'match', scope: 'html.text', pattern: /[^<&]+/, when: { after: ['html.tag.end'] } },
      { kind: 'match', scope: 'html.text', pattern: /[^<&]+/, when: { after: ['html.entity', 'html.text'] } },
      { kind: 'match', scope: 'html.text', pattern: /[^<&]+/, when: { firstOnLine: true } },
      { kind: 'match', scope: 'html.invalid', pattern: /[<&]/ },
    ],
    fallbackScope: 'html.text',
    validate: checkTagNesting,
    compose: [
      {
        id: 'html-tag',
        when: (context) => context.line.before.endsWith('<') || context.line.before.endsWith('</'),
        range: (context) => context.word,
        items: () =>
          ['div', 'span', 'script', 'style', 'p', 'a'].map((tag) => ({
            label: tag,
            kind: 'html-tag',
            append: '>',
            detail: 'an element',
          })),
      },
    ],
    describe: (context) => {
      const token = context.token
      if (token === undefined) return undefined
      if (token.scope === 'html.tag.name') return { title: `<${token.text}>`, detail: 'an element' }
      if (token.scope === 'html.attr.name') return { title: token.text, detail: 'an attribute' }
      if (token.scope === 'html.entity') return { title: token.text, detail: 'a character reference' }
      return undefined
    },
    comments: { block: ['<!--', '-->'] },
  })
}

// ── Markdown, and the registry a fence reads ────────────────────────────────

/** The language every info string names, and the whole of what Markdown knows. */
export const COMPOSITE_LANGUAGES: Readonly<Record<string, Grammar>> = {
  json: jsonGrammar,
  javascript: scriptGrammar,
  js: scriptGrammar,
  css: styleGrammar,
  html: markupGrammar(),
}

/**
 * Markdown with embedded languages: the outer grammar of the composite document.
 *
 * The fence is one rule, and it carries all four languages: `grammar` is a function of the
 * frame the region opened, so ```` ```json ```` and ```` ```html ```` reach different
 * grammars through the same declaration — and an info string the document does not know
 * leaves an ordinary opaque region rather than an error, because a fence naming a language
 * nobody registered is a fence, not a mistake.
 * @returns the grammar.
 */
export function compositeGrammar(): Grammar {
  return defineGrammar({
    id: 'composite',
    name: 'Markdown (composite)',
    wordChars: /[\p{L}\p{N}_-]/u,
    rules: [
      {
        kind: 'region',
        scope: 'code.fence',
        begin: /```(\w*)[^\n]{0,60}/,
        // The `m` flag is kept by the engine's search, so this is a closing fence on a line
        // of its own rather than the next three backticks anywhere in the file.
        end: /^[ \t]*```/m,
        openScope: 'md.fence.marker',
        closeScope: 'md.fence.marker',
        contentScope: 'code',
        when: { firstOnLine: true },
        grammar: (frame) => COMPOSITE_LANGUAGES[frame.groups[1] ?? ''],
        unclosed: {
          message: 'This code fence is never closed, so everything after it reads as code.',
          code: 'unclosed-fence',
          severity: 'warning',
        },
      },
      {
        kind: 'region',
        scope: 'md.frontmatter',
        begin: /^---\n/,
        end: /^---[ \t]*$/m,
        openScope: 'md.meta.marker',
        closeScope: 'md.meta.marker',
        contentScope: 'md.meta',
        unclosed: { message: 'This front matter is never closed.', code: 'unclosed-frontmatter', severity: 'warning' },
      },
      { kind: 'match', scope: 'md.heading', pattern: /#{1,6}[^\n]*/, when: { firstOnLine: true } },
      { kind: 'match', scope: 'md.quote', pattern: />[^\n]*/, when: { firstOnLine: true } },
      { kind: 'match', scope: 'md.list.marker', pattern: /([-*+]|\d+\.)\s/, when: { firstOnLine: true } },
      { kind: 'match', scope: 'md.rule', pattern: /-{3,}[ \t]*$/, when: { firstOnLine: true } },
      {
        kind: 'region',
        scope: 'md.code.inline',
        begin: /`/,
        end: /`/,
        openScope: 'md.code.marker',
        closeScope: 'md.code.marker',
        contentScope: 'code',
        // A region may name its own rules instead of handing its content to a whole
        // language: inline code is one scope and nothing inside it is code of any language.
        rules: [{ kind: 'match', scope: 'code', pattern: /[^`\n]+/ }],
        unclosed: { message: 'This code span is never closed.', code: 'unclosed-code-span', severity: 'warning' },
      },
      {
        kind: 'region',
        scope: 'md.bold',
        begin: /\*\*/,
        end: /\*\*/,
        openScope: 'md.emphasis.marker',
        closeScope: 'md.emphasis.marker',
        contentScope: 'md.emphasis.strong',
        // Transparent, so `**bold with *italic* inside**` really is bold with italic inside:
        // the outer rules run within the region and the double star is still its closer.
        transparent: true,
        unclosed: { message: 'This emphasis is never closed.', code: 'unclosed-emphasis', severity: 'warning' },
      },
      {
        kind: 'region',
        scope: 'md.italic',
        begin: /[*_]/,
        end: /[*_]/,
        openScope: 'md.emphasis.marker',
        closeScope: 'md.emphasis.marker',
        contentScope: 'md.emphasis',
        unclosed: { message: 'This emphasis is never closed.', code: 'unclosed-emphasis', severity: 'warning' },
      },
      {
        kind: 'region',
        scope: 'md.link',
        begin: /\[/,
        end: /\]/,
        openScope: 'md.link.marker',
        closeScope: 'md.link.marker',
        contentScope: 'md.link.label',
        unclosed: { message: 'This link label is never closed.', code: 'unclosed-link', severity: 'warning' },
      },
      {
        kind: 'region',
        scope: 'md.link.target',
        begin: /\(/,
        end: /\)/,
        openScope: 'md.link.marker',
        closeScope: 'md.link.marker',
        contentScope: 'md.link.url',
        // A target follows a label, which is the only place a parenthesised run is a URL.
        when: { after: ['md.link.marker'] },
        unclosed: { message: 'This link target is never closed.', code: 'unclosed-link-target', severity: 'warning' },
      },
      { kind: 'match', scope: 'md.word', pattern: /[^\s*_`#>[\]]+/ },
    ],
    fallbackScope: 'md.text',

    compose: [
      {
        id: 'md-block',
        // A block starter opens a line, and `firstWord` keeps the list alive while the
        // reader is spelling one out.
        when: (context) => context.firstWord,
        range: (context) => context.word,
        items: () => [
          { label: '## ', insert: '## ', kind: 'md-heading', detail: 'a second-level heading' },
          { label: '- ', insert: '- ', kind: 'md-list', detail: 'a list item' },
          { label: '> ', insert: '> ', kind: 'md-quote', detail: 'a quotation' },
          { label: '```json', insert: '```json\n\n```', kind: 'md-fence', caretOffset: -4, detail: 'a JSON block' },
          { label: '```js', insert: '```js\n\n```', kind: 'md-fence', caretOffset: -4, detail: 'a JavaScript block' },
          { label: '```html', insert: '```html\n\n```', kind: 'md-fence', caretOffset: -5, detail: 'an HTML block' },
          { label: '```css', insert: '```css\n\n```', kind: 'md-fence', caretOffset: -4, detail: 'a CSS block' },
        ],
      },
    ],

    describe: (context) => {
      const token = context.token
      if (token === undefined) return undefined
      if (token.scope === 'md.fence.marker') {
        return {
          title: 'fence',
          detail: 'an embedded language',
          body: 'The info string names the grammar that reads the block: json, js, html, or css.',
        }
      }
      if (token.scope === 'md.heading') return { title: token.text, detail: 'a heading' }
      if (token.scope === 'md.link.url') return { title: token.text, detail: 'a link target' }
      return undefined
    },

    // Markdown has no line comment marker, so the block form is the one `Ctrl+/` writes —
    // and inside a fence it is the EMBEDDED language's marker that counts, because the
    // editor resolves the language at the caret.
    comments: { block: ['<!--', '-->'] },
    pairs: [
      { open: '`', close: '`' },
      { open: '[', close: ']' },
      { open: '**', close: '**' },
    ],
  })
}

/** The document the demo opens with: every embedded language, and one mistake in each. */
export const COMPOSITE_DEFAULT = [
  '---',
  'title: composite',
  '---',
  '',
  '# One document, four languages',
  '',
  'Markdown with **bold, and *italic* inside it**, `inline code`, and a',
  '[link](https://example.com) — all of it the outer grammar.',
  '',
  '```json',
  '{',
  '  "name": "litearea",',
  '  "quote": "she said \\"hi\\"",   // the escapes keep this one string',
  '  "name": "again",      // the duplicate the JSON validator reports',
  '  "note": "never closed',
  '}',
  '```',
  '',
  '```js',
  '// JavaScript, with its own completion, its own strings, and its own markers',
  'const greeting = "a quote: \\" and a slash: \\\\"',
  'function run(count) { return count + 1 }',
  '```',
  '',
  '```html',
  '<div class="card" id="main">',
  '  <span>an entity: &amp; and a mismatch below</span>',
  '  <span>this one closes the div</div>',
  '  <script>',
  '    const inside = "JavaScript, embedded in the HTML, embedded in the Markdown"',
  '  </script>',
  '</div>',
  '```',
  '',
  '```css',
  '.card { colour: red; color: #fff; padding: 4px }',
  '```',
  '',
  '```rust',
  '// A language this document does not know is still a fence: opaque, and not an error.',
  'fn main() {}',
  '```',
  '',
].join('\n')
