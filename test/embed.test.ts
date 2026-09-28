// ─── embedded languages: one document, several grammars ──────────────────────
//
// The composite half of the engine, checked against both a real composite document
// (`examples/demo/grammars/composite.ts`: Markdown embedding JSON, JavaScript, CSS, and
// HTML, which embeds JavaScript and CSS in turn) and a handful of grammars small enough to
// read in one screen.
//
// The two files answer different questions. The demo document proves that a real language
// written against the feature works end to end — four languages deep, with the diagnostics
// of each one landing at the right offsets. The synthetic grammars prove the primitives
// individually: a region that swaps the rule list, a rule gated by the region it is in, a
// closing delimiter derived from the one that opened it, an escape that keeps a string
// whole, and a completion or a hover answered by the language the caret is actually in.

import { describe, expect, it } from 'vitest'
import {
  complete,
  defineGrammar,
  inspect,
  languageAt,
  languageChain,
  resolveHover,
  scan,
} from '../src/index.js'
import type { Grammar, Rule, Token } from '../src/core/types.js'
import { COMPOSITE_DEFAULT, compositeGrammar } from '../examples/demo/grammars/composite.js'

/** The painted `scope:text` pairs of a token list, which is what a paint test is about. */
function painted(tokens: readonly Token[]): string[] {
  return tokens.map((token) => `${token.scope}:${token.text}`)
}

/** The painted pairs of one language inside a composite document. */
function paintedIn(document: string, id: string): string[] {
  const inspection = inspect(document, compositeGrammar())
  const spans = inspection.languages.filter((span) => span.id === id)
  expect(spans.length).toBeGreaterThan(0)
  return painted(
    inspection.tokens.filter((token) =>
      spans.some((span) => token.from >= span.from && token.to <= span.to),
    ),
  )
}

describe('a region that swaps the rule list', () => {
  const inner: readonly Rule[] = [
    { kind: 'match', scope: 'inner.word', pattern: /[a-z]+/ },
    { kind: 'match', scope: 'inner.digit', pattern: /\d+/ },
  ]

  it('runs the declared rules inside the region instead of the outer ones', () => {
    const grammar: Grammar = {
      id: 'swap',
      rules: [
        { kind: 'region', scope: 'block', begin: /</, end: />/, rules: inner },
        { kind: 'match', scope: 'outer.word', pattern: /[a-z]+/ },
      ],
    }
    const result = scan('alpha <beta 7> gamma', grammar)

    expect(painted(result.tokens.filter((token) => token.text.trim() !== ''))).toEqual([
      'outer.word:alpha',
      'block:<',
      'inner.word:beta',
      'inner.digit:7',
      'block:>',
      'outer.word:gamma',
    ])
  })

  it('tries the declared rules first and falls through to the outer list when transparent', () => {
    const grammar: Grammar = {
      id: 'mixed',
      rules: [
        { kind: 'region', scope: 'block', begin: /\{/, end: /\}/, transparent: true, rules: inner },
        { kind: 'match', scope: 'outer.word', pattern: /[a-z]+/ },
        { kind: 'match', scope: 'outer.punct', pattern: /[=+]/ },
      ],
    }
    // `{a=1}`: `a` and `1` are the region's own rules, `=` is left to the outer list.
    const result = scan('{a=1}', grammar)
    expect(painted(result.tokens.filter((token) => token.text.trim() !== ''))).toEqual([
      'block:{',
      'inner.word:a',
      'outer.punct:=',
      'inner.digit:1',
      'block:}',
    ])
  })

  it('lets a rule list be a function of the frame that opened the region', () => {
    const grammar: Grammar = {
      id: 'by-tag',
      rules: [
        {
          kind: 'region',
          scope: 'block',
          begin: /<(\w+)>/,
          end: /<\/(\w+)>/,
          rules: (frame) =>
            frame.groups[1] === 'num'
              ? [{ kind: 'match', scope: 'num', pattern: /\d+/ }]
              : [{ kind: 'match', scope: 'word', pattern: /[a-z]+/ }],
        },
      ],
    }
    expect(paintedIn2(scan('<num>42</num>', grammar).tokens)).toContain('num:42')
    expect(paintedIn2(scan('<txt>ok</txt>', grammar).tokens)).toContain('word:ok')
  })
})

/** The painted pairs of a token list, without the whitespace. */
function paintedIn2(tokens: readonly Token[]): string[] {
  return painted(tokens.filter((token) => token.text.trim() !== ''))
}

describe('a rule gated by the region it is in', () => {
  const grammar: Grammar = {
    id: 'gated',
    rules: [
      { kind: 'region', scope: 'template', begin: /\{\{/, end: /\}\}/, transparent: true },
      { kind: 'match', scope: 'emphasis', pattern: /[*][^*\n]+[*]/, when: { notInRegion: ['template'] } },
      { kind: 'match', scope: 'braced', pattern: /[*][^*\n]+[*]/, when: { region: ['template'] } },
      { kind: 'match', scope: 'word', pattern: /[a-z]+/ },
    ],
  }

  it('keeps a rule out of a region and lets another take its place', () => {
    const outside = scan('*a*', grammar)
    expect(paintedIn2(outside.tokens)).toEqual(['emphasis:*a*'])

    const inside = scan('{{*a*}}', grammar)
    expect(paintedIn2(inside.tokens)).toEqual([
      'template:{{',
      'braced:*a*',
      'template:}}',
    ])
  })

  it('tests every enclosing region, not only the innermost', () => {
    const nested: Grammar = {
      id: 'nested-gate',
      rules: [
        { kind: 'region', scope: 'outer', begin: /\[/, end: /\]/, transparent: true },
        { kind: 'region', scope: 'inner', begin: /\(/, end: /\)/, transparent: true },
        { kind: 'match', scope: 'in-outer', pattern: /x/, when: { region: ['outer'] } },
        { kind: 'match', scope: 'plain', pattern: /x/ },
      ],
    }
    // `([x])`: the match is inside `inner` AND inside `outer`, and `region` asks about both.
    expect(paintedIn2(scan('([x])', nested).tokens)).toEqual([
      'inner:(',
      'outer:[',
      'in-outer:x',
      'outer:]',
      'inner:)',
    ])
  })
})

describe('a closing delimiter derived from the opening one', () => {
  const tags: Grammar = {
    id: 'tags',
    rules: [
      {
        kind: 'region',
        scope: 'element',
        begin: /<([a-zA-Z][\w-]*)[^>]*>/,
        // The frame remembers what opened it, which is the only way `<div>` can know that
        // the `</div>` three tags later is its own.
        end: (frame) => new RegExp(`</${frame.groups[1] ?? ''}[ \\t]*>`),
        nested: true,
        openScope: 'tag.open',
        closeScope: 'tag.close',
        contentScope: 'tag.body',
        unclosed: { severity: 'error', code: 'tag-unclosed', message: (match) => `<${match.groups[1] ?? ''}> is never closed.` },
      },
      { kind: 'match', scope: 'text', pattern: /[^<]+/ },
      { kind: 'match', scope: 'punct', pattern: /</ },
    ],
  }

  it('pairs each tag with its own name, through nesting', () => {
    const result = scan('<div>a<span>b</span>c</div>', tags)
    expect(paintedIn2(result.tokens)).toEqual([
      'tag.open:<div>',
      'tag.body:a',
      'tag.open:<span>',
      'tag.body:b',
      'tag.close:</span>',
      'tag.body:c',
      'tag.close:</div>',
    ])
    expect(result.diagnostics).toEqual([])
  })

  it('reports the tag that was never closed, over its own opening delimiter', () => {
    const text = '<div><span>a</div>'
    const result = scan(text, tags)
    // The `</div>` is the div's own delimiter, so it closes the div — and the span it covered
    // is reported unclosed, over the `<span>` that opened it.
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['tag-unclosed'])
    expect(text.slice(result.diagnostics[0]?.from ?? 0, result.diagnostics[0]?.to ?? 0)).toBe('<span>')
    expect(paintedIn2(result.tokens).at(-1)).toBe('tag.close:</div>')
  })
})

describe('an escape that keeps a region whole', () => {
  const strings: Grammar = {
    id: 'strings',
    rules: [
      {
        kind: 'region',
        scope: 'string',
        begin: /"/,
        end: /"/,
        escapes: '\\',
        openScope: 'punct',
        closeScope: 'punct',
        contentScope: 'string',
        unclosed: { severity: 'error', code: 'unclosed-string' },
      },
      { kind: 'match', scope: 'word', pattern: /[a-z]+/ },
    ],
  }

  it('ignores an escaped delimiter and counts an even run as a close', () => {
    const escaped = scan('"a \\" b" c', strings)
    expect(paintedIn2(escaped.tokens)).toEqual(['punct:"', 'string:a \\" b', 'punct:"', 'word:c'])
    expect(escaped.diagnostics).toEqual([])

    // Two backslashes are an escaped backslash, so the quote after them really closes the
    // string: escaping is counted, not flagged.
    const doubled = scan('"a\\\\" b', strings)
    expect(doubled.diagnostics).toEqual([])
    expect(paintedIn2(doubled.tokens)).toEqual(['punct:"', 'string:a\\\\', 'punct:"', 'word:b'])
  })

  it('still reports a string that never closes', () => {
    const result = scan('"a b', strings)
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['unclosed-string'])
  })
})

describe('scan hands embedded regions over', () => {
  const json: Grammar = {
    id: 'json',
    rules: [
      { kind: 'match', scope: 'json.number', pattern: /\d+/ },
      { kind: 'match', scope: 'json.other', pattern: /\S/ },
    ],
  }
  const markdown: Grammar = {
    id: 'md',
    rules: [
      { kind: 'region', scope: 'fence', begin: /```(\w*)/, end: /```/, contentScope: 'code', grammar: json },
      { kind: 'match', scope: 'md.word', pattern: /[^\s`]+/ },
    ],
  }

  it('paints the embedded region as one opaque span and lists it in `embeds`', () => {
    const text = 'see\n```\n42 x\n```\n'
    const result = scan(text, markdown)
    // One span for the whole content, newlines included: the region is found in a single
    // search and `inspect` is what replaces it with the embedded language's paint.
    expect(paintedIn2(result.tokens)).toEqual(['md.word:see', 'fence:```', 'code:\n42 x\n', 'fence:```'])
    expect(result.embeds).toHaveLength(1)
    expect(result.embeds[0]).toMatchObject({
      from: text.indexOf('```'),
      contentFrom: text.indexOf('```') + 3,
      contentTo: text.lastIndexOf('```'),
      to: text.lastIndexOf('```') + 3,
      scope: 'code',
    })
  })

  it('keeps the delimiters when the content is painted the same scope', () => {
    const inner: Grammar = {
      id: 'inner',
      rules: [{ kind: 'match', scope: 'inner.word', pattern: /[a-z]+/ }],
    }
    const outer: Grammar = {
      id: 'outer',
      rules: [{ kind: 'region', scope: 'code', begin: /\[/, end: /\]/, grammar: inner }],
    }
    // `scope` is what open, content, and close all default to, so the content and its closing
    // delimiter MERGE into one token — and the splice still has to leave both delimiters
    // painted. That is what clipping a partly overlapping token is for.
    const text = '[beta]'
    const inspection = inspect(text, outer)
    expect(paintedIn2(inspection.tokens)).toEqual(['code:[', 'inner.word:beta', 'code:]'])
  })

  it('falls back to an opaque region when the language chooser declines', () => {
    const known: Grammar = {
      id: 'known',
      rules: [
        {
          kind: 'region',
          scope: 'fence',
          begin: /```(\w*)/,
          end: /```/,
          contentScope: 'code',
          grammar: (frame) => (frame.groups[1] === 'json' ? json : undefined),
        },
      ],
    }
    expect(scan('```json\n42\n```', known).embeds).toHaveLength(1)
    expect(scan('```rust\nfn\n```', known).embeds).toEqual([])
  })
})

describe('a document with four languages in it', () => {
  const grammar = compositeGrammar()

  it('paints each region with its own grammar', () => {
    expect(paintedIn(COMPOSITE_DEFAULT, 'json')).toContain('json.key:"name"')
    expect(paintedIn(COMPOSITE_DEFAULT, 'json')).toContain('json.string:litearea')
    expect(paintedIn(COMPOSITE_DEFAULT, 'javascript')).toContain('js.keyword:const')
    expect(paintedIn(COMPOSITE_DEFAULT, 'css')).toContain('css.value.color:#fff')
  })

  it('paints the JavaScript inside the HTML with the JavaScript grammar', () => {
    // Three deep: Markdown holds an HTML fence, and the HTML holds a `<script>`.
    const tokens = paintedIn(COMPOSITE_DEFAULT, 'javascript')
    expect(tokens).toContain('js.keyword:const')
    // The string's CONTENT is what carries the scope; the quotes are punctuation.
    expect(tokens).toContain(
      'js.string:JavaScript, embedded in the HTML, embedded in the Markdown',
    )
  })

  it('reports each language`s problem, at the offset inside the region', () => {
    const inspection = inspect(COMPOSITE_DEFAULT, grammar)
    const byCode = new Map(inspection.diagnostics.map((entry) => [entry.code, entry]))

    expect([...byCode.keys()].sort()).toEqual([
      'duplicate-key',
      'tag-mismatch',
      'unclosed-string',
      'unknown-property',
    ])

    const duplicate = byCode.get('duplicate-key')
    expect(duplicate?.source).toBe('json')
    expect(COMPOSITE_DEFAULT.slice(duplicate?.from ?? 0, duplicate?.to ?? 0)).toBe('"name"')
    expect(duplicate?.severity).toBe('warning')

    const mismatch = byCode.get('tag-mismatch')
    expect(mismatch?.source).toBe('html')
    expect(COMPOSITE_DEFAULT.slice(mismatch?.from ?? 0, mismatch?.to ?? 0)).toBe('</div>')

    const property = byCode.get('unknown-property')
    expect(property?.source).toBe('css')
    expect(COMPOSITE_DEFAULT.slice(property?.from ?? 0, property?.to ?? 0)).toBe('colour')
  })

  it('lists one span per embedded region, and the unknown fence is not one', () => {
    const inspection = inspect(COMPOSITE_DEFAULT, grammar)
    expect(inspection.languages.map((span) => span.id)).toEqual([
      'json',
      'javascript',
      'html',
      'javascript',
      'css',
    ])
    // The `rust` fence names a language the document does not know: a fence, not an error,
    // and not a language.
    expect(inspection.languages.some((span) => span.id === 'rust')).toBe(false)
    expect(inspection.diagnostics.some((entry) => entry.code === 'unclosed-fence')).toBe(false)
  })

  it('answers which language owns an offset, innermost first', () => {
    const inspection = inspect(COMPOSITE_DEFAULT, grammar)
    const script = COMPOSITE_DEFAULT.indexOf('const inside')
    const html = COMPOSITE_DEFAULT.indexOf('<span>an entity')
    const prose = COMPOSITE_DEFAULT.indexOf('Markdown with')

    expect(languageAt(inspection, script)?.id).toBe('javascript')
    expect(languageAt(inspection, script)?.depth).toBe(2)
    expect(languageAt(inspection, html)?.id).toBe('html')
    expect(languageAt(inspection, html)?.depth).toBe(1)
    expect(languageAt(inspection, prose)).toBeUndefined()

    expect(languageChain(inspection, script).map((span) => span.id)).toEqual(['html', 'javascript'])
    expect(languageChain(inspection, prose)).toEqual([])
  })

  it('carries each language`s own word characters, pairs, and comments', () => {
    const inspection = inspect(COMPOSITE_DEFAULT, grammar)
    const script = COMPOSITE_DEFAULT.indexOf('const inside')
    const json = COMPOSITE_DEFAULT.indexOf('"litearea"')
    const prose = COMPOSITE_DEFAULT.indexOf('Markdown with')

    const inScript = languageAt(inspection, script)
    const inJson = languageAt(inspection, json)

    // `-` is a word character of Markdown's names and not of JSON's, so a completion
    // inside the fence replaces a different word than one outside it.
    expect(grammar.wordChars?.test('-')).toBe(true)
    expect(inJson?.grammar.wordChars.test('-')).toBe(false)
    expect(inScript?.grammar.wordChars.test('$')).toBe(true)
    // The comment markers and the pairs come from the embedded grammar too.
    expect(inScript?.grammar.grammar.comments).toEqual({ line: '//', block: ['/*', '*/'] })
    expect(inJson?.grammar.grammar.comments).toEqual({ line: '//' })
    expect(languageAt(inspection, prose)).toBeUndefined()
  })

  it('sees the begin groups, the region scopes, and the depth from a scope function', () => {
    const seen: Array<{ region?: string; depth?: number; tag?: string | undefined; grammarId?: string }> = []
    const inner: Grammar = {
      id: 'inner',
      rules: [
        {
          kind: 'match',
          scope: (match) => {
            seen.push({
              ...(match.region === undefined ? {} : { region: match.region }),
              ...(match.depth === undefined ? {} : { depth: match.depth }),
              tag: match.beginGroups?.[1],
              ...(match.grammarId === undefined ? {} : { grammarId: match.grammarId }),
            })
            return 'inner.word'
          },
          pattern: /[a-z]+/,
        },
      ],
    }
    const outer: Grammar = {
      id: 'outer',
      rules: [
        // A `rules` region, not a `grammar` one: an embedded language is scanned as a
        // document of its own, so the region it sits in is the OUTER grammar's business and
        // the outer frame is not on the embedded scanner's stack. A region that swaps the
        // rule list in place does see it, which is what this asserts.
        { kind: 'region', scope: 'code', begin: /```(\w+)/, end: /```/, contentScope: 'code.fence', rules: inner.rules },
      ],
    }
    scan('```json\nvalue\n```', outer)

    expect(seen).toContainEqual({ region: 'code.fence', depth: 1, tag: 'json', grammarId: 'outer' })
  })
})

describe('completion and hover follow the caret into an embedded language', () => {
  const grammar = compositeGrammar()

  it('offers the embedded grammar`s rows inside a fence', () => {
    const text = '```json\ntr\n```\n'
    const inspection = inspect(text, grammar)
    const caret = text.indexOf('tr') + 2
    const result = complete(inspection, grammar, { text, caret, trigger: 'auto' })

    expect(result?.sourceId).toBe('json-value')
    expect(result?.range).toEqual({ from: text.indexOf('tr'), to: caret })
    expect(result?.rows.map((row) => row.item.label)).toContain('true')
  })

  it('offers the outer grammar`s rows outside every fence', () => {
    const text = '## heading\n'
    const inspection = inspect(text, grammar)
    // The caret is at the very start of the line, which is the only place a block starter
    // applies; `firstWord` is what keeps the list alive once the reader starts spelling one.
    const result = complete(inspection, grammar, { text, caret: 0, trigger: 'explicit' })
    expect(result?.sourceId).toBe('md-block')
  })

  it('gives a tie to the innermost language, and a named priority to the outer one', () => {
    const inner: Grammar = {
      id: 'inner',
      rules: [{ kind: 'match', scope: 'word', pattern: /[a-z]+/ }],
      compose: [{ id: 'inner-rows', range: (context) => context.word, items: () => [{ label: 'inner' }] }],
    }
    const outer: Grammar = {
      id: 'outer',
      rules: [{ kind: 'region', scope: 'code', begin: /</, end: />/, contentScope: 'code', grammar: inner }],
      compose: [{ id: 'outer-rows', range: (context) => context.word, items: () => [{ label: 'outer' }] }],
    }
    const text = '<ab>'
    const inspection = inspect(text, outer)
    const inside = complete(inspection, outer, { text, caret: 3, trigger: 'auto' })
    expect(inside?.sourceId).toBe('inner-rows')

    const boosted: Grammar = {
      ...outer,
      compose: [
        {
          id: 'outer-rows',
          priority: 5,
          range: (context: { word: { from: number; to: number } }) => context.word,
          items: () => [{ label: 'outer' }],
        },
      ],
    }
    const inspection2 = inspect(text, boosted)
    const won = complete(inspection2, boosted, { text, caret: 3, trigger: 'auto' })
    expect(won?.sourceId).toBe('outer-rows')
  })

  it('asks the embedded grammar for the hover, and falls back to the outer one', () => {
    const text = '```json\ntrue\n```\nprose\n'
    const inspection = inspect(text, grammar)

    const inside = resolveHover(inspection, grammar, text.indexOf('true') + 1)
    expect(inside?.title).toBe('true')
    expect(inside?.detail).toBe('the boolean true')

    const outside = resolveHover(inspection, grammar, text.indexOf('prose'))
    expect(outside).toBeUndefined()
  })

  it('reports the language that answered, so an acceptance reaches that grammar', () => {
    const text = '```json\ntr\n```\n'
    const inspection = inspect(text, grammar)
    const caret = text.indexOf('tr') + 2
    expect(complete(inspection, grammar, { text, caret, trigger: 'auto' })?.grammarId).toBe('json')

    const prose = '## heading\n'
    const outer = complete(inspect(prose, grammar), grammar, {
      text: prose,
      caret: 0,
      trigger: 'explicit',
    })
    expect(outer?.grammarId).toBe('composite')
  })

  it('rebases a decoration an embedded language produced', () => {
    const inner: Grammar = {
      id: 'inner',
      rules: [{ kind: 'match', scope: 'inner.word', pattern: /[a-z]+/ }],
      decorate: (text) => [{ from: 0, to: text.length, kind: 'block', title: 'inner block' }],
    }
    const outer: Grammar = {
      id: 'outer',
      rules: [
        { kind: 'region', scope: 'code', begin: /\[/, end: /\]/, contentScope: 'code', grammar: inner },
      ],
    }
    const text = 'alpha [beta] gamma'
    const inspection = inspect(text, outer)
    const decoration = inspection.decorations.find((entry) => entry.kind === 'block')

    // The inner grammar's decoration was written against the region's CONTENT, and it arrives
    // at the document's offsets — which is what lets a sticky header, a semantic mark, or a
    // tooltip come from inside an embedded language.
    expect(text.slice(decoration?.from ?? 0, decoration?.to ?? 0)).toBe('beta')
    expect(decoration?.title).toBe('inner block')
  })

  it('describes an embedded token with the embedded grammar`s own docs', () => {
    const text = '```js\nconst x = 1\n```\n'
    const inspection = inspect(text, grammar)
    const hover = resolveHover(inspection, grammar, text.indexOf('const') + 1)
    expect(hover?.title).toBe('const')
    expect(hover?.detail).toBe('a binding that cannot be reassigned')
  })
})

describe('embedding nests as deep as the languages do', () => {
  it('inspects a language inside a language inside a language', () => {
    const third: Grammar = {
      id: 'third',
      rules: [{ kind: 'match', scope: 'third.word', pattern: /[a-z]+/ }],
    }
    const second: Grammar = {
      id: 'second',
      rules: [
        { kind: 'region', scope: 'second.inner', begin: /\(/, end: /\)/, contentScope: 'second.inner', grammar: third },
        { kind: 'match', scope: 'second.word', pattern: /[a-z]+/ },
      ],
    }
    const first: Grammar = {
      id: 'first',
      rules: [{ kind: 'region', scope: 'first.inner', begin: /\[/, end: /\]/, contentScope: 'first.inner', grammar: second }],
    }
    const text = '[abc(def)ghi]'
    const inspection = inspect(text, first)

    expect(inspection.tokens.map((token) => `${token.scope}:${token.text}`)).toContain(
      'third.word:def',
    )
    expect(inspection.languages.map((span) => `${span.id}@${String(span.depth)}`)).toEqual([
      'second@1',
      'third@2',
    ])
    expect(languageAt(inspection, text.indexOf('def'))?.id).toBe('third')
    // The outermost region's scope is what the innermost token carries as its region,
    // because the third language's tokens were spliced in through the second one.
    const token = inspection.tokens.find((entry) => entry.text === 'def')
    expect(token?.region).toBe('second.inner')
  })

  it('keeps the outer document`s paint around the embedded one', () => {
    const inner: Grammar = {
      id: 'inner',
      rules: [{ kind: 'match', scope: 'inner.word', pattern: /[a-z]+/ }],
    }
    const outer: Grammar = {
      id: 'outer',
      rules: [
        { kind: 'region', scope: 'code', begin: /\[/, end: /\]/, openScope: 'punct', closeScope: 'punct', contentScope: 'code', grammar: inner },
        { kind: 'match', scope: 'outer.word', pattern: /[a-z]+/ },
      ],
    }
    const inspection = inspect('alpha [beta] gamma', outer)
    expect(inspection.tokens.filter((token) => token.text.trim() !== '').map((token) => `${token.scope}:${token.text}`)).toEqual([
      'outer.word:alpha',
      'punct:[',
      'inner.word:beta',
      'punct:]',
      'outer.word:gamma',
    ])
    // Document order survives the splice, and every token carries the right line.
    expect(inspection.tokens.every((token, index, all) => index === 0 || token.from >= (all[index - 1]?.from ?? 0))).toBe(true)
  })
})

describe('an unclosed embedded region', () => {
  it('runs to the end of the document, reports it, and still embeds the language', () => {
    const inner: Grammar = {
      id: 'inner',
      rules: [{ kind: 'match', scope: 'inner.word', pattern: /[a-z]+/ }],
    }
    const outer: Grammar = {
      id: 'outer',
      rules: [
        {
          kind: 'region',
          scope: 'code',
          begin: /```/,
          end: /```/,
          contentScope: 'code',
          grammar: inner,
          unclosed: { code: 'unclosed-fence', severity: 'warning' },
        },
      ],
    }
    const text = '```\nbeta\n'
    const inspection = inspect(text, outer)

    expect(inspection.diagnostics.map((entry) => entry.code)).toEqual(['unclosed-fence'])
    expect(inspection.languages[0]).toMatchObject({ id: 'inner', from: 0, to: text.length })
    expect(paintedIn2(inspection.tokens)).toContain('inner.word:beta')
    expect(languageAt(inspection, text.length)?.id).toBe('inner')
  })
})
