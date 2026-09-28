// ─── hover: what the pointer is resting on ─────────────────────────────────
//
// A tooltip is only worth showing when it says something the text does not, and
// there are exactly three things that qualify: a problem, a semantic mark the
// grammar made, and the grammar's own explanation of a token. They are consulted
// in that order and the first one that has something to say wins.
//
// A diagnostic leads deliberately. The other two describe what the text IS, and
// the user resting the pointer on a red squiggle is asking what is WRONG with it
// — answering "circle: a full disc" there would be technically true and useless,
// and it is exactly the behaviour that makes people stop hovering.

import type { Decoration, Diagnostic, Grammar, HoverContext, HoverInfo, Severity } from './types.js'
import type { Inspection } from './inspect.js'
import { languageChain } from './inspect.js'
import { containsOffset, lineAt, lineStarts, tokenAt, wordInfoAt } from './text.js'
import { isResolvedGrammar, resolveGrammar, type ResolvedGrammar } from './scan.js'

/** One language that may describe an offset, with its own analysis. */
interface DescribingLanguage {
  resolved: ResolvedGrammar<any>
  state: unknown
}

/** The word a severity is shown under, as VSCode titles its hovered diagnostics. */
const SEVERITY_TITLE: Record<Severity, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
  hint: 'Hint',
}

/**
 * Turn one diagnostic into a tooltip.
 *
 * Exported because a host that shows its own marker list wants the same wording,
 * and because a test should be able to assert the tooltip without going through
 * the ordering rules below.
 * @param diagnostic - the diagnostic.
 * @returns the tooltip.
 */
export function diagnosticHover(diagnostic: Diagnostic): HoverInfo {
  return {
    kind: 'diagnostic',
    title: SEVERITY_TITLE[diagnostic.severity],
    detail: diagnostic.source,
    body: diagnostic.detail === undefined ? diagnostic.message : `${diagnostic.message}\n\n${diagnostic.detail}`,
    range: { from: diagnostic.from, to: diagnostic.to },
  }
}

/**
 * Resolve what a hover should show at an offset.
 *
 * @param inspection - the current inspection.
 * @param grammar - the document's own language. An embedded language that owns the offset
 *   is asked first, and this one answers only where the embedded one had nothing to say.
 * @param offset - the character offset the pointer resolved to.
 * @returns the tooltip, or undefined when there is nothing to say.
 */
export function resolveHover<State>(
  inspection: Inspection<State>,
  grammar: Grammar<State> | ResolvedGrammar<State>,
  offset: number,
): HoverInfo | undefined {
  const resolved = isResolvedGrammar(grammar) ? grammar : resolveGrammar(grammar)
  const { text, tokens, diagnostics, decorations, state } = inspection

  // ── a problem outranks a description ─────────────────────────────────────
  // The narrowest diagnostic wins when several overlap, so a squiggle inside a
  // wider warning still explains itself rather than its container. Nothing about
  // embedding changes this: a diagnostic raised INSIDE an embedded language is a
  // diagnostic like any other, rebased into the document it was found in.
  let covering: Diagnostic | undefined
  for (const diagnostic of diagnostics) {
    if (!containsOffset(diagnostic, offset)) continue
    if (covering === undefined || diagnostic.to - diagnostic.from < covering.to - covering.from) {
      covering = diagnostic
    }
  }
  if (covering !== undefined) return diagnosticHover(covering)

  // ── the languages that may describe this offset ──────────────────────────
  // Innermost first, the document's own last: the language the pointer is actually in
  // answers, and an outer language only fills a gap the inner one left — which is how a
  // Markdown hover can explain a fenced block that the embedded language kept quiet about.
  const languages: DescribingLanguage[] = []
  for (const span of [...languageChain(inspection, offset)].reverse()) {
    languages.push({ resolved: span.grammar, state: span.state })
  }
  languages.push({ resolved: resolved as ResolvedGrammar<any>, state })

  // ── a mark the grammar made, combined with its own account of the token ──
  // Both, rather than one or the other. A decoration's title is short by design ("in
  // effect: Geist Mono") and the grammar's description is rich but says nothing about
  // the mark, so a tooltip that showed only one of them would always be missing the
  // half the reader wanted.
  const decoration: Decoration | undefined = decorations.find((entry) => containsOffset(entry, offset))
  const described = describeAt(inspection, languages, offset)
  if (decoration?.title !== undefined) {
    return {
      kind: 'decoration',
      title: decoration.title,
      detail: described?.detail ?? described?.title,
      body: described?.body,
      range: { from: decoration.from, to: decoration.to },
    }
  }

  return described
}

/**
 * Ask the grammars in play what a token is.
 *
 * Split out because the decoration branch above wants the same answer and must not
 * build a second context for it — one parse, one description, however many tooltips
 * are made from it.
 * @param inspection - the current inspection.
 * @param languages - the languages that may answer, innermost first.
 * @param offset - the offset being described.
 * @returns the first description any of them offers, or undefined when none does.
 */
function describeAt(
  inspection: Inspection<any>,
  languages: readonly DescribingLanguage[],
  offset: number,
): HoverInfo | undefined {
  const { text, tokens, diagnostics } = inspection
  const found = tokenAt(tokens, offset)
  // Whitespace is painted like anything else, so a token IS found in blank space — and a
  // grammar handed one will describe it, which is how resting the pointer on a gap produced a
  // tooltip naming the fallback scope. There is no thing under the pointer to explain, so the
  // grammar is told there is no token; a grammar that wants to say something about the
  // POSITION can still do so, because `describe` is called either way.
  const token = found === undefined || found.text.trim() === '' ? undefined : found
  for (const language of languages) {
    const describe = language.resolved.grammar.describe
    if (describe === undefined) continue
    const context: HoverContext<any> = {
      text,
      offset,
      token,
      // Each language grows the word with its own predicate, so a description that talks
      // about "the word under the pointer" means the word as that language reads it.
      word: wordInfoAt(text, offset, language.resolved.wordChars),
      line: lineAt(text, offset, lineStarts(text)),
      tokens,
      diagnostics,
      state: language.state,
    }
    const info = describe(context)
    if (info !== undefined && info !== null) return info
  }
  return undefined
}
