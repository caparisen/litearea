// ─── scan: text in, painted tokens out ──────────────────────────────────────
//
// One left-to-right pass. At each position the rules are tried in the order the
// grammar declared them and the first one that matches wins, which is the whole
// of the precedence model: to make a rule win, put it higher.
//
// A few decisions here are what keep a hand-written grammar honest.
//
// A rule may never match the empty string. A pattern that can, such as `/\w*/`,
// is treated as if it did not match, so the scan cannot stall on one position
// forever. An infinite loop in a highlighter looks exactly like a frozen page.
//
// Consecutive tokens with the same scope are merged. Whitespace is most of a
// document, and one span per space would mean thousands of DOM nodes for a file
// nobody is looking at. Merging stops at a newline, because a token's line and
// column describe where it starts and a span across two lines would make that a
// lie.
//
// A non-nested region is found in one search rather than tested character by
// character, and its contents are painted as a single span without the rule list
// ever running inside it. That is what makes a string a string: the word
// `running` inside a quoted font name is text, not a state.

import type {
  Diagnostic,
  Grammar,
  LineInfo,
  RegionEmbed,
  RegionFrame,
  RegionRule,
  Rule,
  RuleContext,
  RuleMatch,
  Scope,
  ScopeSpec,
  Token,
  VocabularyContext,
  WordsRule,
  WordsSource,
} from './types.js'
import { listPhrase } from './format.js'
import { clamp, isWordChar, lineAt, lineIndexAt, lineStarts } from './text.js'
import { asResolvedVocabulary } from './vocabulary.js'

/** A grammar with its defaults filled in and its patterns made safe to reuse. */
export interface ResolvedGrammar<State = unknown> {
  /**
   * Marks this value as already resolved.
   *
   * Present so the two shapes can be told apart without guessing. The obvious test
   * — "does it have a `fallbackScope`?" — is wrong, because a plain grammar is
   * allowed to declare one, and the mistake surfaces as the engine reading `.grammar`
   * off a value that has no such field and crashing at the first keystroke.
   */
  readonly __resolved: true
  grammar: Grammar<State>
  rules: readonly Rule<State>[]
  /** The scope a character no rule claimed is painted with. */
  fallbackScope: Scope
  /** The single-character test that decides where words begin and end. */
  wordChars: RegExp
}

/**
 * Whether a value is a resolved grammar rather than one as written.
 * @param value - the grammar, either shape.
 * @returns whether it is already resolved.
 */
export function isResolvedGrammar<State>(
  value: Grammar<State> | ResolvedGrammar<State>,
): value is ResolvedGrammar<State> {
  return (value as { __resolved?: unknown }).__resolved === true
}

/** The whole result of one scan: the paint, what the scan noticed, and the analysis. */
export interface ScanResult<State = unknown> {
  tokens: Token[]
  /**
   * What the lexical pass itself found: a word a vocabulary rejected, a region
   * that never closed. A grammar's own `checks` and `validate` are added by
   * `diagnose`, which builds on this.
   */
  diagnostics: Diagnostic[]
  /** Whatever `Grammar.analyze` returned, or `initialState`. */
  state: State
  /**
   * The regions an embedded grammar owns, in document order.
   *
   * The lexical pass does not run an embedded language — that is `inspect`'s job, because
   * a nested language brings its own analysis, checks, and decorations with it. What the
   * scan does is find where each one begins and ends and hand the content over; this list
   * is that handover.
   */
  embeds: RegionEmbed[]
}

/**
 * A region that is currently open, with everything its interior needs.
 *
 * It is a superset of the public {@link RegionFrame}, because the same object is handed
 * to a dynamic `end` and to every scope function inside the region — one frame, one
 * answer about where the match is.
 */
interface OpenRegion<State> extends RegionFrame {
  rule: RegionRule<State>
  /** The offset after the opening delimiter. */
  contentFrom: number
  /** The closing pattern, resolved from a dynamic `end` when the region opened. */
  end: RegExp | undefined
  /** The compiled escape set, when the rule declared one. */
  escaped: RegExp | undefined
  /**
   * The rule list that runs inside, when one does.
   *
   * `undefined` with `runsRules` true means the outer list — a `transparent` region. A
   * region that runs no list at all is opaque and is painted as it is searched.
   */
  innerRules: readonly Rule<State>[] | undefined
  /** Whether any rule list runs inside this region. */
  runsRules: boolean
}

/** The word predicate a grammar that does not declare one gets. */
const DEFAULT_WORD_CHARS = /[\p{L}\p{N}_$]/u

/**
 * A pattern that can be run at a position without ever skipping ahead.
 *
 * The sticky flag is added rather than demanded: a grammar author writing
 * `/foo/` means "foo here", and one who forgot the `y` would otherwise get a
 * pattern that quietly matches anywhere later in the document and paints the
 * wrong text. Compiled patterns are cached per source pattern, so a scan does not
 * recompile one per position.
 */
const stickyCache = new WeakMap<RegExp, RegExp>()

/**
 * A pattern that runs at a position and cannot skip ahead.
 * @param pattern - the rule's pattern.
 * @returns the same pattern with the sticky flag, cached.
 */
function sticky(pattern: RegExp): RegExp {
  const cached = stickyCache.get(pattern)
  if (cached !== undefined) return cached
  const flags = pattern.flags.replace(/[gy]/g, '')
  const compiled = new RegExp(pattern.source, `${flags}y`)
  stickyCache.set(pattern, compiled)
  return compiled
}

/** Run a pattern at an exact position, or report that it did not match there. */
function execAt(pattern: RegExp, source: string, index: number): RegExpExecArray | null {
  pattern.lastIndex = index
  const match = pattern.exec(source)
  return match !== null && match.index === index ? match : null
}

/**
 * Strip the flags that would make a pattern stateful across calls.
 *
 * `RegExp.prototype.test` advances `lastIndex` on a global pattern, so a word
 * predicate carrying one would answer correctly for the first character and then
 * for every other one — a bug that looks like a typo in the grammar and cannot be
 * seen by reading it.
 * @param pattern - the grammar's pattern, if it declared one.
 * @returns a pattern safe to call repeatedly.
 */
function withoutStatefulFlags(pattern: RegExp): RegExp {
  const flags = pattern.flags.replace(/[gy]/g, '')
  return flags === pattern.flags ? pattern : new RegExp(pattern.source, flags)
}

/**
 * Fill in a grammar's defaults and make its patterns safe.
 * @param grammar - the grammar as written.
 * @returns the grammar the scanner runs.
 */
export function resolveGrammar<State>(grammar: Grammar<State>): ResolvedGrammar<State> {
  return {
    __resolved: true,
    grammar,
    rules: grammar.rules,
    fallbackScope: grammar.fallbackScope ?? 'text',
    wordChars: withoutStatefulFlags(grammar.wordChars ?? DEFAULT_WORD_CHARS),
  }
}

/** What a words source resolves to, once per scan. */
interface ResolvedWords {
  list: readonly string[]
  /** Folded member text, for lookup. */
  set: Set<string>
  /**
   * Members containing a character the word predicate rejects, longest first.
   * They cannot be reached by reading a word in, so they are matched literally.
   */
  literal: readonly string[]
  caseSensitive: boolean
}

/**
 * Scan a document into tokens.
 * @param source - the document.
 * @param grammar - the language, as written or already resolved.
 * @returns the tokens, the lexical diagnostics, and the analysis.
 */
export function scan<State>(
  source: string,
  grammar: Grammar<State> | ResolvedGrammar<State>,
): ScanResult<State> {
  const resolved: ResolvedGrammar<State> = isResolvedGrammar(grammar)
    ? grammar
    : resolveGrammar(grammar)
  const { rules, fallbackScope, wordChars } = resolved
  const declared = resolved.grammar
  const sourceId = declared.id
  const state: State =
    declared.analyze === undefined ? (declared.initialState as State) : declared.analyze(source)
  const vocabularyContext: VocabularyContext<State> = { text: source, state }

  const tokens: Token[] = []
  const diagnostics: Diagnostic[] = []
  /** The embedded-language territories this scan found, in document order. */
  const embeds: RegionEmbed[] = []
  const starts = lineStarts(source)
  const length = source.length

  // ── per-scan caches ───────────────────────────────────────────────────────
  // The vocabulary context is constant for a whole scan, so a vocabulary is
  // resolved once rather than at every position that tests a word.
  const wordsCache = new Map<WordsSource<State>, ResolvedWords>()
  /**
   * The line last asked for, so the scan does not re-slice per token.
   *
   * Only the line's BOUNDS are cached, never its column. A column depends on the
   * position being asked about while the bounds do not, and caching the pair
   * together is a bug with a very specific smell: the first token on a line caches
   * column 0, every later token on that line reads it back, and every rule guarded
   * by `firstOnLine` starts matching the whole line.
   */
  let cachedLineNumber = -1
  let cachedLineBounds: { from: number; to: number; text: string } | undefined
  /** Compiled `prevNot` character classes, per rule context. */
  const prevNotCache = new WeakMap<RuleContext, RegExp>()
  /** Compiled `escapes` character classes, per region rule. */
  const escapeCache = new WeakMap<RegionRule<any>, RegExp>()

  /**
   * The character-class test for a region's escape set, if it declared one.
   *
   * The set is a string of CHARACTERS, not a class body: `escapes: '\\'` in a TypeScript
   * source is one backslash, which is what a grammar author means by it. Each character is
   * escaped for the class here, so a `]` or a `-` in the set is a character and not the end
   * of the class.
   * @param rule - the region rule.
   * @returns the compiled class, or undefined when the region has no escapes.
   */
  const escapePatternOf = (rule: RegionRule<any>): RegExp | undefined => {
    if (rule.escapes === undefined) return undefined
    const cached = escapeCache.get(rule)
    if (cached !== undefined) return cached
    const body = [...rule.escapes].map((char) => char.replace(/[\\\]^/-]/g, '\\$&')).join('')
    const compiled = new RegExp(`[${body}]`)
    escapeCache.set(rule, compiled)
    return compiled
  }

  /**
   * Whether the characters immediately before an offset escape it.
   *
   * Escaping is counted rather than flagged, because that is what it is: `"a\\"` is a
   * closed string as far as the reader is concerned, and only an ODD number of escape
   * characters makes the delimiter behind them part of the text. A grammar that treated
   * any backslash as an escape would read `"a\\"` as an unterminated string and tint the
   * rest of the file.
   * @param index - the offset of the closing delimiter.
   * @param pattern - the escape character class, if the region declared one.
   * @returns whether the delimiter is escaped.
   */
  const escapedAt = (index: number, pattern: RegExp | undefined): boolean =>
    isEscaped(source, index, pattern)

  /**
   * The content scopes of the regions currently open, outermost first.
   *
   * Rebuilt only when the stack actually changed, because a rule gated by `region` asks
   * this question at every position it is tried at and the answer is the same until a
   * delimiter moves.
   */
  let regionVersion = 0
  let regionScopeCache: { version: number; scopes: readonly Scope[] } = { version: -1, scopes: [] }
  const regionScopeList = (): readonly Scope[] => {
    if (regionScopeCache.version !== regionVersion) {
      regionScopeCache = { version: regionVersion, scopes: openRegions.map((frame) => frame.scope) }
    }
    return regionScopeCache.scopes
  }

  /** The line record for a position, with the column computed for that position. */
  const lineInfoAt = (position: number): LineInfo => {
    const number = lineIndexAt(starts, position)
    if (number !== cachedLineNumber || cachedLineBounds === undefined) {
      const info = lineAt(source, position, starts)
      cachedLineBounds = { from: info.from, to: info.to, text: info.text }
      cachedLineNumber = number
    }
    const column = clamp(position - cachedLineBounds.from, 0, cachedLineBounds.text.length)
    return {
      from: cachedLineBounds.from,
      to: cachedLineBounds.to,
      text: cachedLineBounds.text,
      number,
      column,
      before: cachedLineBounds.text.slice(0, column),
      after: cachedLineBounds.text.slice(column),
    }
  }

  /** Resolve a words source, once per scan. */
  const resolveWords = (from: WordsSource<State>): ResolvedWords => {
    const cached = wordsCache.get(from)
    if (cached !== undefined) return cached
    const vocabulary = asResolvedVocabulary(from)
    const caseSensitive = vocabulary?.caseSensitive === true
    const raw =
      vocabulary !== undefined
        ? vocabulary.resolve(vocabularyContext)
        : typeof from === 'function'
          ? from(vocabularyContext)
          : from
    const list = Array.isArray(raw) ? raw.filter((word) => word !== '') : []
    const fold = (word: string): string => (caseSensitive ? word : word.toLowerCase())
    const entry: ResolvedWords = {
      list,
      set: new Set(list.map(fold)),
      literal: list
        .filter((word) => [...word].some((char) => !isWordChar(char, wordChars)))
        .slice()
        .sort((left, right) => right.length - left.length),
      caseSensitive,
    }
    wordsCache.set(from, entry)
    return entry
  }

  /** Name a match: a fixed scope, or the grammar's function. */
  const scopeOf = (
    spec: ScopeSpec<State> | undefined,
    match: RuleMatch<State>,
    fallback: Scope,
  ): Scope => (spec === undefined ? fallback : typeof spec === 'function' ? spec(match) : spec)

  /** Whether every predicate a rule declared holds at this position. */
  const contextHolds = (
    when: RuleContext | undefined,
    index: number,
    previousScope: Scope | undefined,
  ): boolean => {
    if (when === undefined) return true
    const info = lineInfoAt(index)
    if (when.firstOnLine === true && info.text.slice(0, info.column).trim() !== '') return false
    if (when.after !== undefined) {
      if (previousScope === undefined || !when.after.includes(previousScope)) return false
    }
    if (when.notAfter !== undefined && previousScope !== undefined) {
      if (when.notAfter.includes(previousScope)) return false
    }
    // The region predicates are the composite-language half of this function: they are
    // what lets one language's rules stand down inside another's territory, and they are
    // answered from the region stack the scanner is already keeping.
    const inside = when.region
    const outside = when.notInRegion
    if (inside !== undefined || outside !== undefined) {
      const open = regionScopeList()
      if (inside !== undefined && !open.some((scope) => inside.includes(scope))) return false
      if (outside !== undefined && open.some((scope) => outside.includes(scope))) return false
    }
    if (when.line !== undefined && !when.line.test(info.text)) return false
    if (when.minColumn !== undefined && info.column < when.minColumn) return false
    if (when.maxColumn !== undefined && info.column > when.maxColumn) return false
    if (when.prevNot !== undefined && index > 0) {
      let pattern = prevNotCache.get(when)
      if (pattern === undefined) {
        pattern = new RegExp(`[${when.prevNot}]`)
        prevNotCache.set(when, pattern)
      }
      // `prevNot` names characters that must NOT precede the match, so a hit here is
      // a failure. At offset zero there is nothing in front of the match, so the
      // predicate holds — a rule guarded this way is not meant to be disabled at the
      // start of the document, which is what returning early there would do.
      if (pattern.test(source.charAt(index - 1))) return false
    }
    return true
  }

  // ── emitting ─────────────────────────────────────────────────────────────

  /** The scope of the innermost enclosing region, for a token's `region`. */
  let regionScope: Scope | undefined
  /** The scope of the nearest preceding non-whitespace token, maintained as we go. */
  let previousScope: Scope | undefined

  /**
   * Append a token, merging it into the previous one when that is invisible.
   * @param scope - the scope to paint.
   * @param from - the first offset.
   * @param to - the offset after the last.
   * @param region - overrides the enclosing region scope, for a fast-path region.
   */
  const push = (scope: Scope, from: number, to: number, region?: Scope): void => {
    if (to <= from) return
    const text = source.slice(from, to)
    const last = tokens[tokens.length - 1]
    if (
      last !== undefined &&
      last.scope === scope &&
      last.to === from &&
      last.region === region &&
      !/[\r\n]/.test(text) &&
      !/[\r\n]/.test(last.text)
    ) {
      last.to = to
      last.text = source.slice(last.from, to)
    } else {
      const info = lineInfoAt(from)
      tokens.push({ from, to, scope, text, line: info.number, column: from - info.from, region })
    }
    if (text.trim() !== '') previousScope = scope
  }

  /** Raise a diagnostic, stamping the grammar's id on it. */
  const report = (problem: {
    from: number
    to: number
    message: string
    severity?: Diagnostic['severity']
    code?: string
  }): void => {
    diagnostics.push({
      from: problem.from,
      to: problem.to,
      message: problem.message,
      severity: problem.severity ?? 'error',
      code: problem.code ?? 'lexical',
      source: sourceId,
    })
  }

  /**
   * The `RuleMatch` a scope function is handed.
   *
   * Inside a region it also carries where the match IS, because a scope function that
   * serves several embedded languages has nothing else to go on: `region` is the
   * innermost content scope, `regions` the whole stack, `beginGroups` the capture groups
   * of the delimiter that opened the innermost one — which is how a fence that carries an
   * info string tells the rules inside it which language they are painting.
   */
  const ruleMatch = (
    text: string,
    from: number,
    groups: readonly (string | undefined)[],
  ): RuleMatch<State> => {
    const frame = openRegions[openRegions.length - 1]
    if (frame === undefined) return { text, source, from, groups, state }
    return {
      text,
      source,
      from,
      groups,
      state,
      region: frame.scope,
      regions: regionScopeList(),
      depth: frame.depth,
      grammarId: sourceId,
      beginGroups: frame.groups,
      beginText: frame.open,
    }
  }

  // ── reading words ────────────────────────────────────────────────────────

  /** The offset after the run of word characters starting at a position. */
  const readWordRun = (index: number): number => {
    let to = index
    while (to < length && isWordChar(source.charAt(to), wordChars)) to += 1
    return to
  }

  /**
   * The whitespace-separated segments a phrase may span.
   *
   * A phrase never crosses a line: a name split over two lines is two names, and
   * letting a vocabulary reach across the break would paint a paragraph as one
   * font.
   */
  const readSegments = (index: number, limit: number): Array<{ from: number; to: number }> => {
    const segments: Array<{ from: number; to: number }> = []
    let cursor = index
    while (segments.length < limit && cursor < length) {
      const to = readWordRun(cursor)
      if (to === cursor) break
      segments.push({ from: cursor, to })
      cursor = to
      const gap = /^[^\S\r\n]+/.exec(source.slice(cursor))?.[0]
      if (gap === undefined) break
      cursor += gap.length
    }
    return segments
  }

  /** The longest member a position spells, or undefined when it spells none. */
  const matchWords = (
    rule: WordsRule<State>,
    words: ResolvedWords,
    index: number,
  ): { to: number; member: string } | undefined => {
    const fold = (word: string): string => (words.caseSensitive ? word : word.toLowerCase())
    const firstTo = readWordRun(index)
    if (firstTo > index) {
      if (rule.phrase !== undefined) {
        const segments = readSegments(index, Math.max(rule.phrase.max ?? 4, 1))
        // Longest first, so a catalogue holding both `IBM Plex` and `IBM Plex
        // Mono` resolves the longer name.
        for (let count = segments.length; count >= 1; count -= 1) {
          const texts = segments.slice(0, count).map((segment) => source.slice(segment.from, segment.to))
          const candidate = texts.join(' ')
          if (words.set.has(fold(candidate))) {
            const last = segments[count - 1]
            if (last !== undefined) return { to: last.to, member: candidate }
          }
        }
      } else {
        const candidate = source.slice(index, firstTo)
        if (words.set.has(fold(candidate))) return { to: firstTo, member: candidate }
      }
    }
    // A member the word predicate cannot read, matched as written. Only tried when reading
    // a word in failed, so the ordinary path pays nothing.
    for (const member of words.literal) {
      // A member containing whitespace is reachable through the phrase path, and matching
      // it literally would ignore `phrase.max` — a cap that only applies on one of the two
      // routes to the same member is not a cap.
      if (rule.phrase !== undefined && /\s/.test(member)) continue
      if (source.startsWith(member, index)) return { to: index + member.length, member }
    }
    return undefined
  }

  /**
   * Whether any rule would claim a position, which is what ends an unclaimed run.
   *
   * @param index - the position.
   * @param previous - the nearest preceding non-whitespace scope, from the run's own point of view.
   * @param activeRules - the rule list running at this position, which is the frame's when one is open.
   * @param frame - the open region the list belongs to, when one is.
   * @returns whether something claims the position.
   */
  const anyRuleClaims = (
    index: number,
    previous: Scope | undefined,
    activeRules: readonly Rule<State>[],
    frame: OpenRegion<State> | undefined,
  ): boolean => {
    // A region's closing delimiter is a claim even though no rule mentions it at this
    // position. Without this the run would swallow the delimiter, the region would never
    // close, and a perfectly well-formed document would be reported as unterminated.
    if (frame !== undefined && frame.end !== undefined) {
      const endMatch = execAt(sticky(frame.end), source, index)
      if (
        endMatch !== null &&
        endMatch[0].length > 0 &&
        !escapedAt(index, frame.escaped)
      ) {
        return true
      }
    }
    for (const rule of activeRules) {
      if (!contextHolds(rule.when, index, previous)) continue
      if (rule.kind === 'region') {
        const match = execAt(sticky(rule.begin), source, index)
        if (match !== null && match[0].length > 0) return true
        continue
      }
      if (rule.kind === 'words') {
        if (matchWords(rule, resolveWords(rule.words), index) !== undefined) return true
        // A rule that reports what it rejects also claims what it rejects:
        // otherwise the word would be swallowed as plain text and the rejection
        // would never be reached.
        if (rule.unknown !== undefined && readWordRun(index) > index) return true
        continue
      }
      const match = execAt(sticky(rule.pattern), source, index)
      if (match !== null && match[0].length > 0) return true
    }
    return false
  }

  // ── the main loop ────────────────────────────────────────────────────────

  /**
   * The regions currently open, innermost last.
   *
   * The stack is what makes a composite language possible. It holds one frame per open
   * delimiter, each with the rule list that runs inside it, the closing pattern that was
   * resolved for it, and the capture groups of the delimiter that opened it — so a rule
   * inside knows where it is, and a region can be closed by a pattern derived from the
   * delimiter that opened it.
   */
  const openRegions: Array<OpenRegion<State>> = []

  /** Open a region: the stack changes, so the region predicates are invalidated. */
  const pushFrame = (frame: OpenRegion<State>): void => {
    openRegions.push(frame)
    regionVersion += 1
    regionScope = frame.scope
  }

  /** Close the innermost region. */
  const popFrame = (): void => {
    openRegions.pop()
    regionVersion += 1
    regionScope = openRegions[openRegions.length - 1]?.scope
  }

  /**
   * Report a region the document ended inside, over its own opening delimiter.
   *
   * The range is the delimiter rather than the rest of the document: an unterminated block
   * comment is a mistake about where it STARTED, and underlining the rest of the file would
   * only say what the reader can already see.
   * @param frame - the frame that is still open.
   */
  const reportUnclosed = (frame: OpenRegion<State>): void => {
    const rule = frame.rule
    report({
      from: frame.from,
      to: frame.contentFrom,
      message:
        rule.unclosed?.message === undefined
          ? `Unterminated ${frame.scope}.`
          : typeof rule.unclosed.message === 'function'
            ? rule.unclosed.message(ruleMatch('', frame.from, ['']))
            : rule.unclosed.message,
      severity: rule.unclosed?.severity ?? 'error',
      code: rule.unclosed?.code ?? 'unclosed-region',
    })
  }

  /**
   * The enclosing frame a delimiter at this position really closes, when the innermost one
   * does not.
   *
   * A missing closer is the ordinary state of a document being typed. `<div><span>a</div>`
   * has a `<span>` with no `</span>`, and the `</div>` that follows is the div's own
   * delimiter — but the innermost frame is the span's, and its pattern does not match.
   *
   * A stack of IDENTICAL delimiters does not have this problem and this function cannot fire
   * for one: `/* a /* b *&#47;` pairs the brackets with one shared pattern, so the innermost
   * frame always answers first and `candidate.end === open.end`. What this recovers is the
   * DYNAMIC end, where every frame resolved a pattern of its own — which is exactly markup,
   * and exactly the case where a reader expects `</div>` to close the div.
   * @param index - the position being tested.
   * @returns the index of the enclosing frame the delimiter closes, or undefined.
   */
  const recoverableFrame = (index: number): number | undefined => {
    const innermost = openRegions[openRegions.length - 1]
    if (innermost === undefined || innermost.end === undefined) return undefined
    for (let frame = openRegions.length - 2; frame >= 0; frame -= 1) {
      const candidate = openRegions[frame]
      if (candidate === undefined) continue
      if (candidate.rule !== innermost.rule) continue
      if (candidate.end === undefined || candidate.end === innermost.end) continue
      const match = execAt(sticky(candidate.end), source, index)
      if (match !== null && match[0].length > 0 && !escapedAt(index, candidate.escaped)) {
        return frame
      }
    }
    return undefined
  }

  /**
   * The frame a region would open, built before anything is pushed.
   *
   * It is what a dynamic `end`, a dynamic `rules`, and a dynamic `grammar` are all handed,
   * so the three see one description of the same opening delimiter and cannot disagree about
   * which language is starting. The frame is also what a `when.region` predicate and a scope
   * function read once the region is open, which is why it is one object and not four.
   * @param rule - the region rule.
   * @param begin - the opening delimiter's match.
   * @param scope - the content scope of the region.
   * @param from - where the opening delimiter starts.
   * @param contentFrom - where the content starts.
   * @param depth - how many regions enclose this one, this one included.
   * @param parent - the frame this region opened inside.
   * @returns the frame.
   */
  const frameOf = (
    rule: RegionRule<State>,
    begin: RegExpExecArray,
    scope: Scope,
    from: number,
    contentFrom: number,
    depth: number,
    parent: OpenRegion<State> | undefined,
  ): RegionFrame => ({
    rule,
    scope,
    from,
    contentFrom,
    open: begin[0],
    groups: [...begin],
    text: source,
    depth,
    grammarId: sourceId,
    parent,
  })

  /**
   * Resolve a region's closing pattern as it opens.
   *
   * A dynamic `end` is called exactly once per frame and its answer is kept, so a function
   * may read the frame's capture groups — which is the whole point, since `<div>` closes at
   * `</div>` and no fixed pattern can say so — without the scan paying for the call at every
   * position inside the region.
   * @param rule - the region rule.
   * @param frame - the frame it is opening.
   * @returns the closing pattern, or undefined when the region names none.
   */
  const resolveEnd = (rule: RegionRule<State>, frame: RegionFrame): RegExp | undefined =>
    typeof rule.end === 'function' ? (rule.end(frame) ?? undefined) : rule.end

  /** The rule list a region runs inside itself, resolved from a function when it declared one. */
  const resolveRules = (
    rule: RegionRule<State>,
    frame: RegionFrame,
  ): readonly Rule<State>[] | undefined =>
    typeof rule.rules === 'function' ? rule.rules(frame) : rule.rules

  /** The language a region embeds, resolved from a function when it declared one. */
  const resolveEmbedded = (
    rule: RegionRule<State>,
    frame: RegionFrame,
  ): Grammar<any> | undefined =>
    typeof rule.grammar === 'function' ? rule.grammar(frame) : rule.grammar

  let index = 0
  while (index < length) {
    const open = openRegions[openRegions.length - 1]

    if (open !== undefined) {
      // The region's own end is always what is tried first, whatever else the rule allows.
      const endMatch = open.end === undefined ? null : execAt(sticky(open.end), source, index)
      if (
        endMatch !== null &&
        endMatch[0].length > 0 &&
        !escapedAt(index, open.escaped)
      ) {
        const closeScope = scopeOf(
          open.rule.closeScope ?? open.rule.scope,
          ruleMatch(endMatch[0], index, [...endMatch]),
          open.scope,
        )
        push(closeScope, index, index + endMatch[0].length, open.scope)
        index += endMatch[0].length
        popFrame()
        continue
      }

      // ── a delimiter that closes a region further out ─────────────────────
      // Only markup can reach this: see `recoverableFrame`. The regions skipped on the way
      // out are reported unclosed, innermost first, because that is the order the reader has
      // to fix them in.
      const recovery = recoverableFrame(index)
      if (recovery !== undefined) {
        for (let frame = openRegions.length - 1; frame > recovery; frame -= 1) {
          const skipped = openRegions[frame]
          if (skipped !== undefined) reportUnclosed(skipped)
        }
        const closing = openRegions[recovery]
        if (closing !== undefined && closing.end !== undefined) {
          const closeMatch = execAt(sticky(closing.end), source, index)
          if (closeMatch !== null && closeMatch[0].length > 0) {
            const closeScope = scopeOf(
              closing.rule.closeScope ?? closing.rule.scope,
              ruleMatch(closeMatch[0], index, [...closeMatch]),
              closing.scope,
            )
            push(closeScope, index, index + closeMatch[0].length, closing.scope)
            index += closeMatch[0].length
          }
        }
        openRegions.length = recovery
        regionVersion += 1
        regionScope = openRegions[openRegions.length - 1]?.scope
        continue
      }

      // ── an opaque region recognises nothing but its own delimiters ───────
      // This is what makes a string a string: the word `running` inside a quoted name is
      // text, not a state. Nesting does NOT lift it — a comment that nests is still a
      // comment all the way down, and a language whose comments behave otherwise would be
      // one nobody could write a comment in.
      if (!open.runsRules) {
        if (open.rule.nested === true) {
          const inner = execAt(sticky(open.rule.begin), source, index)
          if (inner !== null && inner[0].length > 0) {
            const innerMatch = ruleMatch(inner[0], index, [...inner])
            const innerFrom = index
            const innerContent = index + inner[0].length
            push(
              scopeOf(open.rule.openScope ?? open.rule.scope, innerMatch, open.scope),
              index,
              innerContent,
              open.scope,
            )
            // The inner frame gets its OWN closing pattern. That is the difference between
            // a nested comment and nested markup: `[a[b]c]` pairs its brackets with the same
            // pattern, while `<div><span></span></div>` needs the inner tag to be closed by
            // its own name, and only a per-frame resolution can say so.
            const innerFrame = frameOf(
              open.rule,
              inner,
              open.scope,
              innerFrom,
              innerContent,
              open.depth + 1,
              open,
            )
            pushFrame({
              ...open,
              from: innerFrom,
              contentFrom: innerContent,
              open: inner[0],
              groups: [...inner],
              depth: open.depth + 1,
              parent: open,
              end: resolveEnd(open.rule, innerFrame),
            })
            index = innerContent
            continue
          }
        }
        push(open.scope, index, index + 1, open.scope)
        index += 1
        continue
      }
      // A region that runs rules falls through to the list below, which is either the
      // region's own or the outer one, depending on what it declared.
    }

    // The list that runs at this position: the innermost region's own, or the outer list
    // when the region is transparent and declared none.
    const activeRules: readonly Rule<State>[] =
      open !== undefined && open.runsRules ? (open.innerRules ?? rules) : rules

    let matched = false

    for (const rule of activeRules) {
      if (!contextHolds(rule.when, index, previousScope)) continue

      if (rule.kind === 'region') {
        const begin = execAt(sticky(rule.begin), source, index)
        if (begin === null || begin[0].length === 0) continue
        const beginMatch = ruleMatch(begin[0], index, [...begin])
        const scope = scopeOf(rule.scope, beginMatch, 'text')
        const openScope = scopeOf(rule.openScope ?? rule.scope, beginMatch, scope)
        const contentScope = scopeOf(rule.contentScope ?? rule.scope, beginMatch, scope)
        const closeScope = scopeOf(rule.closeScope ?? rule.scope, beginMatch, scope)
        const beginEnd = index + begin[0].length
        const parent = open
        const depth = parent === undefined ? 1 : parent.depth + 1
        const frame = frameOf(rule, begin, contentScope, index, beginEnd, depth, parent)
        // Both of these may be functions of the frame, which is how one fence rule carries
        // every embedded language: `grammar: (frame) => BY_NAME[frame.groups[1]]` reads the
        // info string and hands the content to the language it names.
        const dynamicRules = resolveRules(rule, frame)
        const embedded = resolveEmbedded(rule, frame)
        push(openScope, index, beginEnd, regionScope)

        // ── the embedded language, which is the whole composite feature ────────
        // A region that declares `grammar` owns everything between its delimiters. The
        // outer rule list never runs inside it and its delimiters are its own business, so
        // it is found in one search; `inspect` then reads the content with the nested
        // grammar and splices the result back in at these offsets. Keeping the region a
        // single span is also what keeps the language table a list of DISJOINT ranges,
        // which is what every caret-shaped feature reads.
        if (embedded !== undefined) {
          const end = resolveEnd(rule, frame)
          const close =
            end === undefined
              ? undefined
              : findRegionEnd(end, source, beginEnd, escapePatternOf(rule))
          const contentTo = close === undefined ? length : close.from
          push(contentScope, beginEnd, contentTo, scope)
          embeds.push({
            rule,
            grammar: embedded,
            from: index,
            to: close === undefined ? length : close.to,
            contentFrom: beginEnd,
            contentTo,
            scope: contentScope,
            groups: [...begin],
            open: begin[0],
            depth,
          })
          if (close === undefined) {
            report({
              from: index,
              to: beginEnd,
              message:
                rule.unclosed?.message === undefined
                  ? `Unterminated ${scope}.`
                  : typeof rule.unclosed.message === 'function'
                    ? rule.unclosed.message(beginMatch)
                    : rule.unclosed.message,
              severity: rule.unclosed?.severity ?? 'error',
              code: rule.unclosed?.code ?? 'unclosed-region',
            })
            index = length
          } else {
            push(closeScope, close.from, close.to, scope)
            index = close.to
          }
          matched = true
          break
        }

        // A region that runs a rule list, or that only nests, is tracked on the stack: the
        // stack is what its end is matched against, what the rules inside read, and what an
        // unterminated one is reported from. Everything else takes the fast path below.
        const runsRules = dynamicRules !== undefined || rule.transparent === true
        if (runsRules || rule.nested === true) {
          pushFrame({
            ...frame,
            end: resolveEnd(rule, frame),
            escaped: escapePatternOf(rule),
            // A transparent region that also declares rules runs BOTH, declared first: the
            // list it names gets the first turn at every position and the enclosing list gets
            // whatever it leaves. Resolved once, here, rather than concatenated per position.
            innerRules:
              dynamicRules !== undefined && rule.transparent === true
                ? [...dynamicRules, ...rules]
                : dynamicRules,
            runsRules,
          })
          index = beginEnd
          matched = true
          break
        }

        // The common case: find the end in one search rather than re-testing at
        // every character, and paint the whole middle as a single span.
        const end = resolveEnd(rule, frame)
        const close =
          end === undefined ? undefined : findRegionEnd(end, source, beginEnd, escapePatternOf(rule))
        if (close === undefined) {
          // An unterminated region may be painted apart from a terminated one: `unclosed.scope`
          // is what lets a grammar say "this is not a string, it is a broken string", which is
          // the difference between a reader trusting the colours and being misled by them.
          push(
            scopeOf(rule.unclosed?.scope === undefined ? undefined : rule.unclosed.scope, beginMatch, contentScope),
            beginEnd,
            length,
            scope,
          )
          report({
            from: index,
            to: beginEnd,
            message:
              rule.unclosed?.message === undefined
                ? `Unterminated ${scope}.`
                : typeof rule.unclosed.message === 'function'
                  ? rule.unclosed.message(beginMatch)
                  : rule.unclosed.message,
            severity: rule.unclosed?.severity ?? 'error',
            code: rule.unclosed?.code ?? 'unclosed-region',
          })
          index = length
          matched = true
          break
        }
        push(contentScope, beginEnd, close.from, scope)
        push(closeScope, close.from, close.to, scope)
        index = close.to
        matched = true
        break
      }

      if (rule.kind === 'words') {
        const words = resolveWords(rule.words)
        const vocabulary = asResolvedVocabulary(rule.words)
        const hit = matchWords(rule, words, index)
        if (hit !== undefined) {
          const text = source.slice(index, hit.to)
          const match = ruleMatch(text, index, [text])
          const scope =
            rule.scope !== undefined
              ? scopeOf(rule.scope, match, 'word')
              : vocabulary?.scopeFor !== undefined
                ? vocabulary.scopeFor(hit.member)
                : 'word'
          push(scope, index, hit.to, regionScope)
          index = hit.to
          matched = true
          break
        }
        if (rule.unknown === undefined) continue
        // Only the first word is consumed. The scanner has no way to know how far
        // a name it has never seen was meant to reach, and guessing would swallow
        // the words that follow it; a multi-word name that is merely misspelled is
        // the grammar's validator's business, where the structure is known.
        const candidateTo = readWordRun(index)
        if (candidateTo <= index) continue
        const word = source.slice(index, candidateTo)
        const rejected = vocabulary?.reject?.(word, vocabularyContext)
        const message =
          rule.unknown.message === undefined
            ? rejected?.message
            : typeof rule.unknown.message === 'function'
              ? rule.unknown.message(word, ruleMatch(word, index, [word]))
              : rule.unknown.message
                .replace(/\{word\}/g, word)
                .replace(/\{allowed\}/g, listPhrase(words.list))
        push(rule.unknown.scope ?? vocabulary?.unknownScope ?? 'invalid', index, candidateTo, regionScope)
        if (message !== undefined) {
          report({
            from: index,
            to: candidateTo,
            message,
            severity: rule.unknown.severity ?? rejected?.severity ?? 'error',
            code: rule.unknown.code ?? rejected?.code ?? 'unknown-word',
          })
        }
        index = candidateTo
        matched = true
        break
      }

      const match = execAt(sticky(rule.pattern), source, index)
      if (match === null || match[0].length === 0) continue
      const matchInfo = ruleMatch(match[0], index, [...match])
      push(scopeOf(rule.scope, matchInfo, fallbackScope), index, index + match[0].length, regionScope)
      index += match[0].length
      matched = true
      break
    }

    if (matched) continue

    // ── nothing claimed this character ─────────────────────────────────────
    // A run of unclaimed characters is taken at once. Whitespace is by far the
    // most common thing no rule claims, and pushing it one character at a time
    // would be both slower and a great many spans.
    //
    // The run carries its own `previous`: once it has consumed a non-whitespace
    // character, the nearest preceding token is the run itself, not whatever came
    // before it. Without that, a rule guarded by `after` would be asked the wrong
    // question part way through and could let the run swallow a word it wanted.
    // Inside a nested region, a character no rule claims is still region content, so
    // it is painted with that region's scope rather than with the document fallback.
    const unclaimed = regionScope ?? fallbackScope
    let to = index
    let runPrevious = previousScope
    while (to < length) {
      const char = source.charAt(to)
      if (char === '\n' || char === '\r') break
      if (anyRuleClaims(to, runPrevious, activeRules, open)) break
      if (/\S/.test(char)) runPrevious = unclaimed
      to += 1
    }
    // `anyRuleClaims(index, ...)` is false here by construction, so this always
    // advances; the guard is against a rule list that disagrees with itself.
    push(unclaimed, index, Math.max(to, index + 1), regionScope)
    index = Math.max(to, index + 1)
  }

  // ── regions the document ended inside ───────────────────────────────────
  // A nested region is closed by the stack, not by a search, so running off the end of the
  // document leaves its frame open with nothing said. Reporting it here is the same fact
  // the opaque path reports when its search fails: a delimiter was opened and never closed.
  // Innermost first, because that is the one the reader has to fix first.
  for (let frame = openRegions.length - 1; frame >= 0; frame -= 1) {
    const open = openRegions[frame]
    if (open !== undefined) reportUnclosed(open)
  }

  return { tokens, diagnostics, state, embeds }
}

/**
 * Whether the characters immediately before an offset escape it.
 *
 * Escaping is counted rather than flagged, because that is what it is: `"a\\"` is a
 * closed string as far as the reader is concerned, and only an ODD number of escape
 * characters makes the delimiter behind them part of the text. A grammar that treated
 * any backslash as an escape would read `"a\\"` as an unterminated string and tint the
 * rest of the file.
 * @param source - the document.
 * @param index - the offset of the delimiter.
 * @param pattern - the escape character class, if the region declared one.
 * @returns whether the delimiter is escaped.
 */
function isEscaped(source: string, index: number, pattern: RegExp | undefined): boolean {
  if (pattern === undefined || index === 0) return false
  let count = 0
  let at = index - 1
  while (at >= 0 && pattern.test(source.charAt(at))) {
    count += 1
    at -= 1
  }
  return count % 2 === 1
}

/**
 * Find a region's closing delimiter at or after a position.
 *
 * The search runs over the rest of the document rather than character by
 * character. The pattern is deliberately stripped of the sticky flag for this one
 * call: the end of a region is *searched for*, not anchored, which is the
 * difference between a string and a string that must begin exactly where the last
 * one ended.
 *
 * With `escapes`, a candidate preceded by an odd number of escape characters is skipped
 * and the search continues past it, which is what makes `"a \"b\""` one string. The
 * skip advances by one character rather than to the end of the candidate, so an escaped
 * delimiter inside a longer one is still found.
 * @param pattern - the rule's `end` pattern.
 * @param source - the document.
 * @param from - where to start looking.
 * @param escaped - the escape character class, when the region declared one.
 * @returns the closing range, or undefined when the region never closes.
 */
function findRegionEnd(
  pattern: RegExp,
  source: string,
  from: number,
  escaped?: RegExp,
): { from: number; to: number } | undefined {
  const probe = new RegExp(pattern.source, `${pattern.flags.replace(/[gy]/g, '')}g`)
  probe.lastIndex = from
  for (;;) {
    const match = probe.exec(source)
    if (match === null || match[0].length === 0) return undefined
    if (!isEscaped(source, match.index, escaped)) {
      return { from: match.index, to: match.index + match[0].length }
    }
    probe.lastIndex = match.index + 1
  }
}
