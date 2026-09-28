// ─── inspect: the one call the editor makes per keystroke ───────────────────
//
// Everything the editor needs to know about a document is computed here, once,
// from one grammar — plus, in a composite document, one nested pass per embedded
// language, each over its own region's text. The paint, the squiggles, the semantic
// decorations, and the structural analysis come out of a single call and are stored
// together, so the completion list and the coloured text cannot be looking at
// different documents.
//
// That is a deliberate inversion of how the editors this library replaces were
// built. Each of them re-derived the tokens, the parse, and the suggestions
// separately, from the same string, in three places — and the three drifted, so
// a word could be painted as a valid value while the completer thought it was
// unknown and the diagnostic pointed at a range that had already moved.
//
// Embedding is where that principle earns its keep twice over. An embedded language is
// inspected as a document of its own — its own `analyze`, checks, and decorations run on
// its own text — and the result is spliced back into the outer document at the region's
// offsets. One pass per text, nested; nothing is parsed twice and nothing can drift. The
// splice also produces the language table, which is what lets a caret inside an embedded
// region complete, hover, auto-close, and comment in that language rather than the outer
// one.

import type {
  CheckRule,
  Decoration,
  DiagnoseContext,
  Diagnostic,
  Grammar,
  LanguageSpan,
  Token,
} from './types.js'
import { listPhrase } from './format.js'
import { lineIndexAt, lineStarts } from './text.js'
import { isResolvedGrammar, resolveGrammar, scan, type ResolvedGrammar } from './scan.js'
import { resolveWordsSource } from './vocabulary.js'

/** Everything one pass over a document produced. */
export interface Inspection<State = unknown> {
  /** The text this was computed from, kept so nothing has to guess its version. */
  text: string
  tokens: Token[]
  /** Lexical problems, the grammar's `checks`, and its `validate`, together. */
  diagnostics: Diagnostic[]
  /** Semantic ranges that are not tokens. */
  decorations: Decoration[]
  /** Whatever `Grammar.analyze` returned. */
  state: State
  /**
   * Every embedded language's territory, outermost first, sorted by position.
   *
   * Empty for a document that embeds nothing, which is the ordinary case. A span is not
   * a token: it says which language OWNS an offset, which is the question every
   * caret-shaped feature asks — which `wordChars` grow the word a completion replaces,
   * which `pairs` close a bracket, which `comments` a `Ctrl+/` writes, whose `compose`
   * sources are eligible, and whose `describe` answers a hover.
   */
  languages: readonly LanguageSpan[]
}

/**
 * Run a grammar's declarative checks over the tokens.
 *
 * A check is the shape most vocabulary mistakes actually take — "this token is
 * one of these words or it is wrong" — and expressing it declaratively means the
 * message, the severity, and the code are declared once instead of being
 * reassembled by hand at every site.
 * @param source - the document.
 * @param grammar - the resolved grammar.
 * @param tokens - the scanned tokens.
 * @param state - the analysis, so a check may consult a vocabulary the machine supplied.
 * @returns the diagnostics the checks raised.
 */
function runChecks<State>(
  source: string,
  grammar: ResolvedGrammar<State>,
  tokens: readonly Token[],
  state: State,
): Diagnostic[] {
  const checks = grammar.grammar.checks
  if (checks === undefined || checks.length === 0) return []
  const diagnostics: Diagnostic[] = []
  // The ANALYSIS, not `initialState`. A `WordsSource` function is documented as receiving
  // the grammar's analysis, and the point of a dynamic vocabulary is that it comes from
  // outside the document — so a check whose allowed set is resolved from `analyze` must
  // see it, or the two halves of one declaration would disagree about what is legal.
  const context = { text: source, state }

  for (const check of checks as readonly CheckRule<State>[]) {
    const members = check.allow === undefined ? undefined : resolveWordsSource(check.allow, context)
    const vocabulary = check.allow === undefined ? undefined : check.allow
    const caseSensitive =
      typeof vocabulary === 'object' && vocabulary !== null && !Array.isArray(vocabulary)
        ? (vocabulary as { caseSensitive?: boolean }).caseSensitive === true
        : false
    const fold = (word: string): string => (caseSensitive ? word : word.toLowerCase())
    const set =
      members === undefined ? undefined : new Set(members.map((member) => fold(member)))
    /** Lines already reported, for a check that only wants one complaint each. */
    const reportedLines = new Set<number>()

    for (const token of tokens) {
      // Whitespace is a token like any other, which means a check written against `'*'` would
      // otherwise underline every space and report it as a misspelling. No one has ever
      // wanted a diagnostic about a space.
      if (token.text.trim() === '') continue
      if (!check.scopes.includes('*') && !check.scopes.includes(token.scope)) continue
      if (check.except !== undefined && check.except.test(token.text)) continue
      if (set !== undefined && set.has(fold(token.text))) continue
      if (check.perLine === true) {
        if (reportedLines.has(token.line)) continue
        reportedLines.add(token.line)
      }
      diagnostics.push({
        from: token.from,
        to: token.to,
        severity: check.severity ?? 'error',
        message: check.message
          .replace(/\{word\}/g, token.text)
          .replace(/\{allowed\}/g, listPhrase(members ?? [])),
        code: check.code,
        detail: check.detail,
        source: grammar.grammar.id,
      })
    }
  }
  return diagnostics
}

/**
 * A grammar with its defaults filled in, per embedded language.
 *
 * An embedded grammar is resolved once and kept, because `inspect` runs on every keystroke and
 * a document with four fences would otherwise re-derive four fallback scopes and four word
 * predicates each time. Keyed on the declared object, so a host that rebuilds a grammar to
 * change it gets a new entry — which is the same rule the editor's own `refresh()` follows.
 */
const resolvedEmbedded = new WeakMap<Grammar<any>, ResolvedGrammar<any>>()

/**
 * Resolve an embedded grammar, from the cache when it has been seen before.
 * @param grammar - the grammar the region named.
 * @returns the resolved grammar.
 */
function resolveEmbeddedGrammar(grammar: Grammar<any>): ResolvedGrammar<any> {
  const cached = resolvedEmbedded.get(grammar)
  if (cached !== undefined) return cached
  const resolved = resolveGrammar(grammar)
  resolvedEmbedded.set(grammar, resolved)
  return resolved
}

/**
 * Inspect a document: paint, problems, decorations, and structure in one pass.
 *
 * Embedded languages are inspected too, each over the text of its own region, and their
 * results are merged here — tokens spliced at the region's offsets, diagnostics and
 * decorations rebased, and one language span per territory so a caller can ask which
 * language owns a caret.
 * @param source - the document.
 * @param grammar - the language, as written or already resolved.
 * @returns everything the editor needs for one text.
 */
export function inspect<State>(
  source: string,
  grammar: Grammar<State> | ResolvedGrammar<State>,
): Inspection<State> {
  const resolved = isResolvedGrammar(grammar) ? grammar : resolveGrammar(grammar)
  return inspectDocument(source, resolved, 0) as Inspection<State>
}

/**
 * Inspect one text with one grammar, and every language it embeds.
 *
 * Every offset this returns is relative to the text it was given, and the caller shifts a
 * child's result by the child's `contentFrom`. That is what makes the recursion compose:
 * a region three languages deep is shifted once per level on the way out, and nothing has
 * to know how deep it is.
 * @param source - the text this grammar reads. For an embedded language it is the region's
 *   content and nothing else, so its `analyze` sees exactly what it owns.
 * @param resolved - the grammar, resolved.
 * @param depth - how many embedded languages already enclose this text.
 * @returns the inspection, relative to `source`.
 */
function inspectDocument(
  source: string,
  resolved: ResolvedGrammar<any>,
  depth: number,
): Inspection<any> {
  const declared = resolved.grammar
  const scanned = scan(source, resolved)
  const tokens = scanned.tokens
  const diagnostics: Diagnostic[] = [...scanned.diagnostics]
  const decorations: Decoration[] = []
  const languages: LanguageSpan[] = []
  const starts = lineStarts(source)

  // The checks run over the grammar's OWN tokens, before any embedded language is spliced
  // in. A check is a statement about this language's words, and an embedded language that
  // happens to use one of its scope names is not this language's business.
  diagnostics.push(...runChecks(source, resolved, tokens, scanned.state))

  if (declared.validate !== undefined) {
    const context: DiagnoseContext<any> = {
      text: source,
      tokens,
      state: scanned.state,
      report: (problem) => {
        diagnostics.push({
          from: problem.from,
          to: problem.to,
          severity: problem.severity ?? 'error',
          message: problem.message,
          code: problem.code ?? 'validate',
          detail: problem.detail,
          source: declared.id,
        })
      },
    }
    declared.validate(context)
  }

  if (declared.decorate !== undefined) {
    decorations.push(...declared.decorate(source, scanned.state))
  }

  // ── the embedded languages ────────────────────────────────────────────────
  // Each one is a document of its own, read with its own grammar, and then moved into
  // place: its offsets are shifted, its paint replaces the outer content span, and its own
  // embedded languages come along with it. The recursion is what makes a language inside a
  // language inside a language work, and what keeps the language table nested rather than
  // flat.
  for (const embed of scanned.embeds) {
    const innerGrammar = resolveEmbeddedGrammar(embed.grammar)
    const shift = embed.contentFrom
    const inner = inspectDocument(
      source.slice(embed.contentFrom, embed.contentTo),
      innerGrammar,
      depth + 1,
    )

    // The outer paint of the region's content gives way to the embedded paint. A token that
    // only partly overlaps is clipped rather than dropped, because a delimiter painted the
    // same scope as its content can merge into one span and that span still holds text on
    // both sides of the region.
    removeRange(source, starts, tokens, embed.contentFrom, embed.contentTo)

    for (const token of inner.tokens) {
      const from = token.from + shift
      const line = lineIndexAt(starts, from)
      tokens.push({
        ...token,
        from,
        to: token.to + shift,
        text: source.slice(from, token.to + shift),
        line,
        column: from - (starts[line] ?? 0),
        region: token.region ?? embed.scope,
      })
    }
    for (const diagnostic of inner.diagnostics) {
      diagnostics.push({
        ...diagnostic,
        from: diagnostic.from + shift,
        to: diagnostic.to + shift,
      })
    }
    for (const decoration of inner.decorations) {
      decorations.push({ ...decoration, from: decoration.from + shift, to: decoration.to + shift })
    }
    for (const language of inner.languages) {
      languages.push({
        ...language,
        from: language.from + shift,
        to: language.to + shift,
        // A language inside a language is as deep again as the language it was found in.
        depth: language.depth + depth,
      })
    }
    languages.push({
      id: innerGrammar.grammar.id,
      ...(innerGrammar.grammar.name === undefined ? {} : { name: innerGrammar.grammar.name }),
      depth: depth + 1,
      from: embed.from,
      to: embed.to,
      scope: embed.scope,
      groups: embed.groups,
      open: embed.open,
      grammar: innerGrammar,
      state: inner.state,
    })
  }

  // The splice appends, so document order is restored by sorting. Tokens never overlap, so
  // the sort is a stable rearrangement rather than a merge of ranges.
  tokens.sort((left, right) => left.from - right.from || left.to - right.to)
  languages.sort((left, right) => left.from - right.from || left.depth - right.depth)

  return {
    text: source,
    tokens,
    diagnostics: normalizeDiagnostics(diagnostics),
    decorations: normalizeDecorations(decorations, source.length),
    state: scanned.state,
    languages,
  }
}

/**
 * The embedded language that owns an offset, innermost when languages nest.
 *
 * A caret just past the end of the document is inside an unclosed region rather than after
 * it, so the end of the text counts as inside the span that reaches it.
 * @param inspection - the inspection.
 * @param offset - the character offset.
 * @returns the innermost span containing the offset, or undefined outside every language.
 */
export function languageAt(
  inspection: Inspection<any>,
  offset: number,
): LanguageSpan | undefined {
  let best: LanguageSpan | undefined
  for (const language of inspection.languages) {
    if (!spanContains(inspection, language, offset)) continue
    if (best === undefined || language.depth > best.depth) best = language
  }
  return best
}

/**
 * Every embedded language enclosing an offset, outermost first.
 *
 * The document's own grammar is not in the list — it is not embedded in anything — so a
 * caller reads a chain by appending its own grammar to the end.
 * @param inspection - the inspection.
 * @param offset - the character offset.
 * @returns the enclosing spans, from the outermost language to the innermost.
 */
export function languageChain(
  inspection: Inspection<any>,
  offset: number,
): readonly LanguageSpan[] {
  const chain: LanguageSpan[] = []
  for (const language of inspection.languages) {
    if (spanContains(inspection, language, offset)) chain.push(language)
  }
  return chain.sort((left, right) => left.depth - right.depth)
}

/**
 * Whether a span owns an offset.
 * @param inspection - the inspection, for the document's length.
 * @param language - the span.
 * @param offset - the character offset.
 * @returns whether the language owns it.
 */
function spanContains(
  inspection: Inspection<any>,
  language: LanguageSpan,
  offset: number,
): boolean {
  if (offset < language.from) return false
  if (offset < language.to) return true
  return offset === language.to && language.to === inspection.text.length
}

/**
 * Remove the paint of a range that another language is about to own.
 *
 * A token wholly inside the range is dropped; one that overlaps an edge is clipped to what
 * lies outside. Clipping rather than dropping is what keeps a merged delimiter span — an
 * opening delimiter and its content painted the same scope come out as one token — from
 * taking the delimiter's colour with it.
 * @param source - the document.
 * @param starts - the document's line starts.
 * @param tokens - the token list, mutated in place.
 * @param from - the first offset to clear.
 * @param to - the offset after the last.
 */
function removeRange(
  source: string,
  starts: readonly number[],
  tokens: Token[],
  from: number,
  to: number,
): void {
  if (to <= from) return
  const kept: Token[] = []
  for (const token of tokens) {
    if (token.to <= from || token.from >= to) {
      kept.push(token)
      continue
    }
    if (token.from < from) kept.push(clip(token, token.from, from, source, starts))
    if (token.to > to) kept.push(clip(token, to, token.to, source, starts))
  }
  tokens.length = 0
  tokens.push(...kept)
}

/**
 * A token's slice, re-addressed.
 * @param token - the token being clipped.
 * @param from - the slice's first offset.
 * @param to - the offset after its last.
 * @param source - the document.
 * @param starts - the document's line starts.
 * @returns the clipped token.
 */
function clip(
  token: Token,
  from: number,
  to: number,
  source: string,
  starts: readonly number[],
): Token {
  const line = lineIndexAt(starts, from)
  return {
    ...token,
    from,
    to,
    text: source.slice(from, to),
    line,
    column: from - (starts[line] ?? 0),
  }
}

/**
 * Sort diagnostics by position and drop duplicates.
 *
 * Two rules can legitimately notice the same mistake — a vocabulary's own
 * rejection and a grammar's validator both know that `nope` is not a colour —
 * and drawing the underline twice makes it darker rather than more informative.
 * Duplicates are compared on position, code, and message, so two genuinely
 * different complaints about one word both survive.
 * @param diagnostics - the collected diagnostics.
 * @returns the deduplicated, ordered list.
 */
export function normalizeDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>()
  const out: Diagnostic[] = []
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.from}:${diagnostic.to}:${diagnostic.code ?? ''}:${diagnostic.message}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(diagnostic)
  }
  return out.sort((left, right) => left.from - right.from || left.to - right.to)
}

/**
 * Clamp decorations into the document and drop the ones that came out empty.
 *
 * A grammar computing decorations from a stale parse can hand over a range that
 * no longer exists, and a decoration outside the text would only produce a span
 * nobody can see.
 * @param decorations - the declared decorations.
 * @param length - the document's length.
 * @returns the usable decorations, ordered.
 */
function normalizeDecorations(decorations: readonly Decoration[], length: number): Decoration[] {
  const out: Decoration[] = []
  for (const decoration of decorations) {
    const from = Math.max(0, Math.min(decoration.from, length))
    const to = Math.max(from, Math.min(decoration.to, length))
    if (to <= from) continue
    out.push({ ...decoration, from, to })
  }
  return out.sort((left, right) => left.from - right.from || left.to - right.to)
}
