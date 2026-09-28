# Grammar reference

The complete contract for a litearea grammar: every field of every rule kind, the
precedence model, the vocabulary helper, diagnostics, hover, and a worked
walkthrough. The short version, with a runnable example, is in the
[README](../README.md#writing-a-grammar).

## One object, one pass

A language is a single object. The engine knows nothing else: there is no
built-in syntax, no bundled tokenizer, and no language identifier to switch on.

```
rules     → what is painted            (lexical, declarative)
analyze   → what the document MEANS    (structural, one pass, optional)
checks    → what is wrong with it      (declarative checks over the tokens)
validate  → what is wrong with it      (the grammar's own hook)
compose   → what can come next         (completion sources)
describe  → what a thing is            (hover tooltips)
decorate  → what is semantically true  (ranges that are not tokens)
onAccept  → what just changed          (after a row is accepted)
```

Those eight fields are six *stages*: the engine's own header groups `checks` and
`validate` under the single word `diagnose`, and `onAccept` reacts to a change rather
than producing one. The language is one object rather than several registrations
because three separate passes over one string (paint, parse, suggest) are three chances
to disagree. Here `analyze` runs once per text and its result is handed to every hook
that wants it.

| Field | Required | What it does |
| --- | --- | --- |
| `id` | yes | A stable id. It is the default diagnostic `source`, and the one thing a test can rely on |
| `name` | no | A human name, for a status line or a demo |
| `rules` | yes | The lexical pass. Tried in order at every position; first match wins |
| `fallbackScope` | no | The scope for a character no rule claimed. Default `'text'` |
| `wordChars` | no | The single-character test that decides where words begin and end. See [wordChars](#wordchars) |
| `initialState` | no | The state used before `analyze` exists, and when it is skipped |
| `analyze` | no | The single structural pass. Called once per text, before the scan |
| `checks` | no | Declarative "this token must be one of these words" checks |
| `validate` | no | The grammar's own validator, for what a check cannot express |
| `compose` | no | The ways this grammar offers completions |
| `describe` | no | What a thing is, when the pointer rests on it |
| `decorate` | no | Semantic ranges that are not tokens |
| `onAccept` | no | Called by the editor after a row is accepted |

Every hook is optional except `rules`. A grammar with nothing but `rules` is a
plain highlighter; add `compose` and it completes; add `checks` and it complains.
Use `defineGrammar` to declare one: it is an identity function that infers `State`
from `analyze` and enforces it everywhere else, and `defineCompletion` does the same
for one source.

A grammar may also embed other grammars. A region that declares `grammar` hands its
content to a language of its own, which brings its own rules and hooks;
`Inspection.languages` says which language owns which offsets, and every caret-shaped
feature follows the caret into the embedded language. It is one field on one rule; see
[Embedded languages](#embedded-languages).

## Rules

```ts
type Rule<State> = MatchRule<State> | WordsRule<State> | RegionRule<State>
```

All three kinds may carry a `when` predicate; the two that paint a name may carry
a `scope`. `scope` is a `Scope` (a plain string) or a function of the match:

```ts
type ScopeSpec<State> = Scope | ((match: RuleMatch<State>) => Scope)
```

A function is handed everything a lexical decision could need:

| `RuleMatch` field | What it is |
| --- | --- |
| `text` | The matched text |
| `source` | The whole document |
| `from` | Where the match starts |
| `groups` | The capture groups; index 0 is the whole match |
| `state` | Whatever `analyze` returned |
| `region` | The content scope of the innermost open region, when the match is inside one. The same value `Token.region` gets and `when.region` tests |
| `regions` | Every enclosing region's content scope, outermost first |
| `depth` | How many regions enclose the match. `1` for the outermost region |
| `grammarId` | The `id` of the grammar whose rule list is running |
| `beginGroups` | The capture groups of the innermost region's `begin`. This is how a rule knows WHICH language it is in when one region rule declares several |
| `beginText` | The text of the innermost region's opening delimiter |

The six region fields are present only where a region encloses the match: at the top
level there is no frame to describe them with, so they are absent rather than empty.
`region`, `regions`, `depth`, `beginGroups`, and `beginText` all describe the innermost
frame, and `grammarId` names the grammar that owns the rule list the match came from,
which inside a `grammar` region is the embedded grammar.

The `state` field earns the function form: a scope can depend on something the characters
do not say. A grammar for a host's installed fonts uses it to paint a weight word as
`weight` or `weight.missing`, depending on the faces the host reported.

### `match`: a regular expression

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | `'match'` | |
| `pattern` | `RegExp` | Tried at the current position. The engine adds the sticky flag (`y`), so a pattern never has to be anchored and can never skip ahead |
| `scope` | `ScopeSpec` | The scope to paint |
| `when` | `RuleContext` | Extra positional predicates |

Compiled patterns are cached per source pattern, so a scan does not recompile one
per position.

### `words`: a vocabulary

A word is its own rule kind rather than sugar over `match`: it can be resolved at scan
time from data outside the document, it can span several words when a name contains a
space, and a word that is *not* in the set is a fact to report.

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | `'words'` | |
| `words` | `WordsSource` | A `readonly string[]`, a `ResolvedVocabulary`, or `(context) => readonly string[]` |
| `scope` | `ScopeSpec` | Overrides the vocabulary's own scope for this rule only |
| `phrase` | object | Lets one entry span several words |
| `when` | `RuleContext` | Extra positional predicates |
| `unknown` | object | What to do with a word-shaped token that is not a member |

`WordsSource` as a function is called **once per scan** with `{ text, state }`, so a
dynamic vocabulary (the fonts actually installed, the states the host actually has)
costs one call, not one per token.

`phrase`:

| Field | Default | Notes |
| --- | --- | --- |
| `max` | 4 | The most words one entry may span. A span longer than `max` is never attempted, and four covers a name like `Source Han Serif SC`, which is four words |

The engine tries the longest span first and keeps the longest member it finds, so
a catalogue holding both `IBM Plex` and `IBM Plex Mono` resolves the longer name.
Words are separated by any run of whitespace that does not contain a newline; the
separators are part of the matched span and are painted with the member's own
scope. A phrase never crosses a line: a name split over two lines is two names.

Setting `phrase` also makes `max` a real cap: a member containing whitespace would
otherwise be reachable through the literal fallback, the path that matches a member's
exact text when `wordChars` cannot read it in, and a cap on only one of the two routes to
the same member is not a cap. The literal path still serves members whose characters are
not word characters for another reason, such as `-apple-system`.

`unknown`:

| Field | Notes |
| --- | --- |
| `scope` | The scope a rejected word is painted with. Falls back to the vocabulary's `unknownScope`, then `'invalid'` |
| `message` | A string with `{word}` and `{allowed}` substituted, or `(word, match) => string`. Absent, the vocabulary's own rejection message is used |
| `severity` | Default: the vocabulary's `unknownSeverity`, then `'error'` |
| `code` | Default: the vocabulary's `unknownCode`, then `'unknown-word'` |

With `unknown` absent, a non-member does not match and a later rule gets its turn, which
is what a grammar with two overlapping vocabularies wants. With `unknown` present, the
rule *claims* the word-shaped run: painting it, reporting it, and stopping anything below
from seeing it. Write `unknown: {}` to take the vocabulary's own rejection and nothing
else.

Only the first word-shaped token is consumed: the scanner cannot know how far a name it
has never seen was meant to reach, and guessing would swallow the words that follow it. A
multi-word name that is merely misspelled is the grammar's validator's business, where
the structure is known.

### `region`: a delimited block

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | `'region'` | |
| `begin` | `RegExp` | The opening delimiter, matched at the position |
| `end` | `RegionEnd` | The closing delimiter: a `RegExp`, or `(frame: RegionFrame) => RegExp \| undefined`. A plain or `grammar` region **searches** for it from the end of `begin`; a `nested`, `transparent`, or rule-carrying one tries it at each position, with the same first match |
| `scope` | `ScopeSpec` | The scope of the whole region when the three below are not given |
| `openScope` | `ScopeSpec` | The opening delimiter. Defaults to `scope` |
| `closeScope` | `ScopeSpec` | The closing delimiter. Defaults to `scope` |
| `contentScope` | `ScopeSpec` | What lies between. Defaults to `scope` |
| `nested` | `boolean` | Default `false`. The same rule may open again inside itself; the contents stay opaque |
| `transparent` | `boolean` | Default `false`. The grammar's other rules also apply inside. Implies nesting. With `rules` as well, the declared list is tried first and the outer list gets whatever it leaves |
| `rules` | `readonly Rule[] \| ((frame: RegionFrame) => readonly Rule[] \| undefined)` | A rule list that runs inside the region instead of the outer one. A function is handed the frame the region opened |
| `grammar` | `Grammar \| ((frame: RegionFrame) => Grammar \| undefined)` | A whole embedded language: its own rules, analysis, checks, completion, hover, pairs, and comments. See [Embedded languages](#embedded-languages) |
| `escapes` | `string` | The characters that escape the closing delimiter, as a set of characters — `escapes: '\\'` is one backslash |
| `when` | `RuleContext` | Extra positional predicates |
| `unclosed` | object | What an unterminated region reports |

`end`, `rules`, and `grammar` may each be a function of the frame the region opened. One
object is built before the region is pushed, so all three see the same description of the
same opening delimiter:

| `RegionFrame` field | What it is |
| --- | --- |
| `rule` | The rule that opened the region |
| `scope` | The region's content scope — the value `Token.region` and `when.region` report for everything inside |
| `from` | Where the opening delimiter begins |
| `contentFrom` | Where the content begins: the offset after the opening delimiter |
| `open` | The opening delimiter's text |
| `groups` | The capture groups of `begin`; index 0 is the whole match |
| `text` | The text the scan was given: the whole document, or an embedded region's content |
| `depth` | `1` for the outermost region |
| `grammarId` | The `id` of the grammar that owns the rule |
| `parent` | The frame this one opened inside, when it did |

A function is called once per frame, when the region opens, and its answer is kept for
that frame's life, so a dynamic `end` can read `groups[1]` and close `<div>` at `</div>`
without the scan paying for the call at every position inside. An `end` function that
returns `undefined` means the region never closes: it runs to the end of the document and
reports `unclosed`.

A region's interior has four shapes, and the flags and the two rule-carrying fields are the
choice between them; `nested` refines the first.

**Neither flag — the fast path.** The end is found with one search over the rest of
the document, so the content is painted as a single span: one token, even across
several lines. It is also opaque, because the rule list never runs inside it, so the
word `running` inside a quoted string is text and not a state. The price is that an
inner delimiter is not matched: `/* a /* b */ c */` without flags closes at the
**first** `*/`, so ` c */` is read as document text.

**`nested: true` — the delimiters are matched, the content is still opaque.** A
region that nests is still a region all the way down, so this flag adds only the
delimiter: the region's own `end` is tried first at every position, then its own
`begin`, and everything else is content. `/* a /* b */ c */` is painted as comment from
end to end: the inner `/* … */` pairs off, and a `[section]` header written inside stays
comment text.

**`transparent: true` — the interior is code.** The rule list runs inside, so the
grammar's rules apply to the content. It implies nesting, because the rule list this
exposes includes the rule that opened the region. It is the flag for a region that is not
prose: a template written in another language, or a string with escapes worth colouring.
The cost is that nothing inside is opaque any more.

```ts
// A nestable block comment: the delimiters pair off, the interior is prose.
{ kind: 'region', scope: 'comment', begin: /\/\*/, end: /\*\//, nested: true }

// A template region whose interior is the language again: `{{ user.name }}` is
// painted by the grammar's own rules, and braces may nest.
{ kind: 'region', scope: 'tmpl', begin: /\{\{/, end: /\}\}/, transparent: true }
```

With `[a [b] c]` and one `word` rule, `nested: true` produces no `word` tokens at all
and no diagnostics, while `transparent: true` produces the words `a`, `b`, and `c`.

**`rules: [...]` — a different rule list, and nothing of the outer language.** The
region names the rules that run inside it: the lightweight half of a composite language,
swapping its rule list without bringing an analysis, a completion source, or a hover. The
list is tried at each position, and the region's own `end` before it, so the delimiters
still close the region; anything the list leaves unclaimed is painted with the region's
content scope. A rule-carrying region is tracked on the stack, so the list may contain the
rule that opened the region: nesting is implied rather than declared. With `transparent:
true` as well, the declared list gets the first turn and the outer list gets whatever it
leaves. Use `grammar` when the embedded language needs an analysis or any hook of its own.

**`grammar: {...}` — a whole embedded language.** The region hands its content to a
grammar of its own, which brings its own rules and hooks: paint, analysis, checks,
completion, hover, pairs, and comments. The outer rule list never runs inside it, its
content is found in one search, and its own delimiters are not matched, so `nested`,
`transparent`, and `rules` are not read on it; `escapes` protects a closing delimiter
written inside the embedded text. A function handed the frame lets one fence rule carry
every embedded language at once: `grammar: (frame) => BY_NAME[frame.groups[1] ?? '']`,
where `undefined` leaves an ordinary opaque region. See
[Embedded languages](#embedded-languages).

**`escapes` — the closing delimiter can be escaped.** The field names the characters that
escape a closing delimiter, as a set of characters rather than a pattern:
`escapes: '\\'` makes `"a \"b\""` one string rather than three tokens. Escaping is
**counted**, not flagged: a closing delimiter preceded by an odd number of escape
characters is not a close, because `"a\\"` is a closed string as far as the reader is
concerned, while reading any backslash as an escape would leave it unterminated. Each
character of the string is one escape character, escaped for the character class the engine
builds, so a set may contain `]`, `-`, or `^` without changing what it means. It applies in
every shape: the one search skips an escaped candidate and continues from the character
after it, and a region on the stack refuses to close at one.

In every shape, a character inside a region that no rule claims is painted with the
region's content scope rather than the document fallback, and adjacent same-scope spans
merge, so a body and its closing delimiter on one line come out as one token. Merging never
crosses a newline: an incrementally painted region is one token per line, a plain region's
body one token however many lines it covers. A `grammar` region's content is one such span,
newlines and all, which is what makes the region one search; `inspect` replaces it with the
embedded language's paint.

An `end` that is never found runs the region to the end of the document, and every shape
reports it: a plain or `grammar` region when its search fails, and a `nested`,
`transparent`, or rule-carrying one when the document ends with a frame still open. An
`end` that can match the empty string counts as never found, and so does an `end` function
that returned `undefined`.

`unclosed`:

| Field | Default |
| --- | --- |
| `message` | `Unterminated <scope>.`, or `(match) => string` |
| `severity` | `'error'` |
| `code` | `'unclosed-region'` |
| `scope` | The scope the unterminated body is painted with instead of `contentScope`. Honoured on the **plain fast path only**, because that is the shape whose body exists as one span to repaint |

The diagnostic's range is the opening delimiter, not the rest of the document.

`unclosed.scope` is how a grammar says "this is not a string, it is a broken string". It
reaches the plain region alone, because that is the shape whose body exists as one span to
repaint. A `nested`, `transparent`, or rule-carrying region is painted as it is scanned,
one run at a time, so only `message`, `severity`, and `code` apply to it; the same three
reach a `grammar` region, whose content span the embedded language paints over.

A region on the stack (`nested`, `transparent`, or rule-carrying) is reported
**innermost first** when the document ends inside it, and each open frame produces its own
diagnostic over its own opening delimiter. A `grammar` region is found in one search like
a plain one, so it reports when that search fails, and the embedded language is still
inspected over the content the document does have. `inspect` then sorts the list by range,
as it does for every diagnostic, so the order a host sees is positional.

### `when` and `RuleContext`

Every predicate that is present must hold. They are predicates about *position*, not about
the parse: a rule that could ask "am I inside a rule named running?" would make the
highlighter a parser. The two region predicates are the one exception, because a region is
not a parse but the lexer's own delimiter stack, and a composite language cannot be
written without asking about it.

| Field | Type | Holds when |
| --- | --- | --- |
| `firstOnLine` | `boolean` | Nothing but whitespace precedes the match on its line — so a match inside a line's indentation counts as first |
| `after` | `readonly Scope[]` | The nearest preceding non-whitespace token has one of these scopes. Fails when there is no preceding token |
| `notAfter` | `readonly Scope[]` | The nearest preceding token does not have one of these scopes. Passes when there is no preceding token |
| `region` | `readonly Scope[]` | Some open region's content scope is one of these. Every enclosing region counts, not only the innermost |
| `notInRegion` | `readonly Scope[]` | No open region's content scope is one of these |
| `line` | `RegExp` | The whole line's text matches. Anchor it yourself (`/^form/`); the engine runs it as written |
| `minColumn` | `number` | The match starts at or after this character column |
| `maxColumn` | `number` | The match starts at or before this character column |
| `prevNot` | `string` | The character immediately before the match is not one of these. It is used as a character class, so `'\\w'` means "not a word character" — the usual way to stop a keyword matching the tail of a longer word. At offset 0 the predicate holds, because there is nothing in front of the match |

Columns are counted in characters, from the start of the line.

`region` and `notInRegion` name a region by its **content scope**, the value
`Token.region` carries and `match.region` reports, and `region` asks about every open
region rather than only the innermost, so a rule can ask "am I inside a code region at
all" however deeply the document nests. An emphasis rule that must not fire inside a
fenced block reads:

```ts
{ kind: 'match', scope: 'emphasis', pattern: /[*_][^_*]+[*_]/, when: { notInRegion: ['code.fence'] } }
```

The stack these predicates are answered from belongs to the scan that is running. A
`rules` or `transparent` region runs in the outer scan, so the outer frames are on it. A
`grammar` region's content is scanned by the embedded language as a document of its own,
so that scan's stack starts empty: an embedded language's `when.region`, and the
`match.region` and `beginGroups` that go with it, describe its own regions.

## Precedence

Four rules decide how a document is painted, and all four are visible from
outside:

1. **First match wins, in declaration order.** At each position the rules are
   tried top to bottom and the first one that matches consumes the position. To
   make a rule win, put it higher. A rule that must not shadow another belongs
   below it.
2. **A rule that can match the empty string is treated as not matching.** A
   pattern such as `/\w*/` is skipped, so the scan cannot stall on one position
   forever. The same guard applies to a region's `begin` and to the sticky test
   for its `end`.
3. **Adjacent tokens with the same scope merge.** Whitespace is most of a
   document, and one span per space would mean thousands of DOM nodes. Merging stops
   at a newline, because a token's `line` and `column` describe where it starts.
   Tokens also merge only when their `region` agrees.
4. **A region's interior runs whatever the region declared, and nothing else.** A
   plain or `nested` region never offers its interior to a rule list, so the word
   `running` inside a quoted string cannot be read as a state. `transparent: true`
   offers it the grammar's own rules, `rules` offers it exactly the list it named,
   and `grammar` hands it to another language altogether — which the outer list
   still never sees inside.

A run of characters no rule claimed is taken in one piece, up to the next rule
match or the end of the line, and painted with `fallbackScope`.

## Embedded languages

A `grammar` region is a region that belongs to another language. It is one field on one
rule, and everything that follows a caret follows it in:

```ts
import { defineGrammar } from '@citisen/litearea'
import type { Grammar, RegionRule } from '@citisen/litearea'

const json: Grammar = defineGrammar({
  id: 'json',
  rules: [{ kind: 'match', scope: 'json.number', pattern: /\d+/ }],
})

const BY_NAME: Readonly<Record<string, Grammar>> = { json }

const fence: RegionRule = {
  kind: 'region',
  scope: 'code.fence',
  begin: /```(\w*)[^\n]{0,40}/,
  end: /^[ \t]*```/m,
  contentScope: 'code',
  // ONE rule, every language the info string can name.
  grammar: (frame) => BY_NAME[frame.groups[1] ?? ''],
}
```

### What the scan does

The region is opaque to the outer rule list and is found in one search, just as a plain
region is. `end` is searched for from the end of `begin`; `escapes` keeps a closing
delimiter written inside the embedded text from closing it early; and `nested`,
`transparent`, and `rules` are not read on the region, because the embedded language owns
its content whole. `scan` paints the content as one span with `contentScope` and records
the territory:

| `RegionEmbed` field | What it is |
| --- | --- |
| `rule` | The rule that declared the embedded grammar |
| `grammar` | The embedded grammar, as declared |
| `from` / `to` | The whole region, opening delimiter included |
| `contentFrom` / `contentTo` | The content, between the delimiters. This is what the nested grammar reads |
| `scope` | The content scope of the region |
| `groups` | The capture groups of `begin` |
| `open` | The opening delimiter's text |
| `depth` | How many regions enclose this one |

`ScanResult.embeds` is that list, in document order. `scan` alone never runs the nested
language, because a language brings an analysis, checks, and decorations with it, and
running them is `inspect`'s job. `inspect` calls the embedded grammar over
`text.slice(contentFrom, contentTo)` and nothing else, so its `analyze` sees only its own
text, and every offset it returns is relative to the content it was given.

`grammar` and `rules` may each be a function of the frame, which is how one fence rule
carries several languages. The function is called once, when the region opens, and is
handed the same `RegionFrame` a dynamic `end` gets, so a chooser can read the info string
out of `groups[1]`. Returning `undefined` leaves an ordinary opaque region, painted with
`contentScope` and nothing more.

### What comes back

The nested inspection is moved into place:

- its tokens replace the region's content span, shifted by `contentFrom` and re-addressed
  to their line and column in the outer document. The outer span is removed first, and a
  token that only partly overlaps it is clipped rather than dropped, so a delimiter
  painted the same scope as its content keeps its colour;
- a token that names no region of its own carries the content scope of the region that
  embedded it as its `region`, so the outer grammar can still tell what an inner token
  sits inside;
- its diagnostics are shifted by the same amount and merged into the document's list,
  deduplicated on position, code, and message and sorted by range, each stamped with its
  own grammar's `id` as `source`; its decorations are shifted, clamped into the document,
  and sorted the same way;
- its own embedded languages come with it, shifted and one level deeper.

Nothing about that is a second pass over the outer text. The outer grammar's `checks` and
`validate` run before the splice, over its own tokens; the embedded grammar's run over
its own.

### `Inspection.languages`

One `LanguageSpan` is recorded per embedded language instance, and a language inside a
language produces its own:

| `LanguageSpan` field | What it is |
| --- | --- |
| `id` / `name` | The embedded grammar's `id`, and its human name when it declared one |
| `depth` | How many embedded languages enclose this one. `1` for a language embedded directly in the document's own |
| `from` / `to` | The territory: the whole region, delimiters included |
| `scope` | The content scope of the region that opened it |
| `groups` / `open` | The capture groups of the region's `begin`, and the opening delimiter's text |
| `grammar` | The embedded grammar, resolved, so its `wordChars` and its rules can be read |
| `state` | What the embedded grammar's `analyze` returned for the region's content |

The table is sorted by position, by `from` then by `depth`, and a span may lie inside
another, which is what `depth` is for. It never contains the document's own grammar.

```ts
import { languageAt, languageChain } from '@citisen/litearea'

const span = languageAt(inspection, offset)      // the innermost language owning the offset
const chain = languageChain(inspection, offset)  // every enclosing language, outermost first
```

`languageAt` answers "which language owns this offset?" and counts the end of the document
as inside a span that reaches it, so a caret just past an unclosed region is inside that
region. `languageChain` is what a caret-shaped feature iterates when several languages
could answer; a caller that wants every language in play appends the document's own
grammar to the end of the chain.

### What follows the caret

| Follows the caret | Where it is read from |
| --- | --- |
| `wordChars` | The innermost language at the offset, so a completion replaces that language's idea of a word: `-apple-system` is one word in a language that says so, and `a.b` is one name in another |
| `pairs` | The language at the offset. A pair's `notIn` scopes are that language's scopes, so a quote is prose inside its string and a delimiter outside it |
| `comments` | The language at the offset, which is what `Ctrl+/` writes. A selection that spans two languages is decided by where it starts |
| `compose` | Every language whose territory encloses the caret, innermost first, and then the document's own |
| `describe` | The same chain, innermost first |

The compose sources of a composite document are collected in that order, and the order is
the tie-breaker: **a tie in `priority` goes to the innermost language**, so an embedded
JSON list beats the outer Markdown one at the same caret, while **an outer source with a
higher explicit `priority` still wins.** Everything else about completion is unchanged:
**once a source has answered it keeps answering** while it stays eligible, and the range
applied is the winner's, recomputed from the caret on every filter. Each source is asked
with its own grammar's `state` and its own `wordChars`.

Hover keeps its order (a diagnostic, then a decoration's title, then `describe`), and
embedding changes one column of it: `describe` is asked innermost first, and an outer
language fills only a gap the inner one left, so a Markdown hover can explain a fenced
block the embedded language kept quiet about. A diagnostic raised inside an embedded
language is rebased into the document it was found in, and the narrowest one covering the
offset still wins.

### What it does not do

- **An embedded language's own pass sees nothing outside its region.** Its `analyze`,
  `rules`, `checks`, `validate`, and `decorate` are handed its region's content and its own
  state, so a JSON analysis never sees the Markdown around it and a Markdown check never
  sees a JSON token. The caret-shaped hooks are the one place the outer document is handed
  over: a `compose` source and a `describe` are given the whole document's `text`,
  `tokens`, and `diagnostics` (one spliced list, shared by every language in play) with
  their own state and their own word characters. What no language ever receives is another
  language's analysis.
- **The outer language never sees inside a `grammar` region.** Its rule list does not run
  there, and its `checks` and `validate` run over its own tokens before the embedded paint
  is spliced in — so an outer check cannot inspect a token an embedded language produced,
  even when the two languages use the same scope name.
- **`indent.unit` and the `sticky` decoration kinds are per editor option, not per
  language.** An indentation unit and the decoration kinds that count as blocks belong to
  `createEditor`; they are the same in every language of one field, however many languages
  it holds.
- **The paint inside a language is still colour, background, and text-decoration.** An
  embedded language cannot change the font, the size, or the weight for its own region:
  the layer has to keep the field's metrics, or every character after the first changed
  glyph would be painted in the wrong place.
- **`scan()` alone paints an embedded region as one opaque span and reports it in
  `ScanResult.embeds`.** The nested language runs in `inspect` only, so a host that reads
  `scan` directly sees where each language is and not what it says.
- **An unclosed embedded region is still embedded.** The region runs to the end of the
  document, is reported over its opening delimiter like any other unclosed region, and the
  nested grammar is still inspected over the content the document does have.

## defineVocabulary

A closed set of words appears four times in a language-aware editor: as the syntax that
accepts it, as the colour it is painted in, as the message a typo earns, and as the
documentation a hover shows. Written out four times they drift, so they are declared once:

```ts
const SHAPES = defineVocabulary({
  id: 'shape',
  words: ['circle', 'rounded', 'square', 'none'],
  unknownMessage: '"{word}" is not a shape — expected {allowed}.',
  docs: { circle: 'A full disc, the background for a busy state.' },
})

// …
{ kind: 'words', words: SHAPES, unknown: {} }
```

| `VocabularySpec` field | Default | What it does |
| --- | --- | --- |
| `id` | — | Used in the default scope and the default diagnostic code |
| `words` | — | The members, or `(context) => readonly string[]` for a set that lives outside the document. Called once per scan |
| `scope` | `vocabulary:<id>` | The scope a member is painted with, or `(word) => Scope` |
| `unknownScope` | `'invalid'` | The scope a rejected word is painted with |
| `unknownMessage` | — | The message a rejected word earns. `{word}` and `{allowed}` are substituted, the latter as a readable list. **Absent, nothing rejects** — membership is simply not enforced |
| `unknownSeverity` | `'error'` | How loudly a rejection complains |
| `unknownCode` | `vocabulary:<id>` | A stable code for the rejection |
| `docs` | — | What each member explains about itself. A bare string is taken as the body |
| `detail` | — | A dimmed line beside a member in the completion list |
| `caseSensitive` | `false` | Whether membership is case-sensitive |
| `format` | identity | How a member is written into the document when accepted — how a family called `IBM Plex Mono` is inserted as `"IBM Plex Mono"` |

The returned `ResolvedVocabulary` is what the engine consumes: `resolve`, `has`,
`scopeFor`, `unknownScope`, `reject`, `entryFor`, and `format`. The test for a vocabulary
is structural rather than `instanceof`, so a host may hand over its own object as long as
it carries those methods, which lets a host wrap a vocabulary in logging, caching, or
translation. `asResolvedVocabulary`, `resolveWordsSource`, and `vocabularyWords` are
exported for the same kind of work.

A vocabulary's rejection only fires where a rule asks for it: `unknownMessage` on its own
changes nothing. Put `unknown: {}` on the `words` rule, or `severity`/`message`/`code`
overrides on it, and the words rule reports.

## wordChars

`wordChars` is a single-character `RegExp` (`/[\p{L}\p{N}_$]/u` by default) and it
decides three things at once:

1. **What a completion replaces.** The word around the caret is expanded in both
   directions with this predicate, and that range is the default a source returns
   from `range`.
2. **What a diagnostic underlines**, when a check runs against a word-shaped
   token.
3. **Where a double click puts the selection**, because that is the platform's
   own word test and the browser uses the same notion of a word the field does.

In a composite document the predicate is the innermost language at the caret, so a word
inside an embedded region is that language's word: the same dot is part of a name in one
language and a full stop in another.

A language whose names contain a dot or a hyphen must say so. A font query uses
`/[\p{L}\p{N}_-]/u` so `-apple-system` is one word; a grammar whose names never contain a
dot leaves it out, so a stray `circle.` is not read as one unknown word.

The flags are normalised: `g` and `y` are stripped, because `RegExp.prototype.test`
advances `lastIndex` on a global pattern, and a predicate carrying one would answer
correctly for the first character and then for every other one.

## analyze

`analyze(text)` is called once per text, before the scan, and its return value is
threaded to every rule's `match.state` and to `validate`, `compose`, `describe`,
and `decorate` as `context.state`. It receives the text and **not** the tokens.

Handing it the tokens would make the scan depend on the analysis that depends on the
scan, and the only ways out of that cycle are a second pass or a fixpoint, both of which
let the analysis disagree with the paint. A structural pass over a line-oriented language
does not need the lexical result anyway: splitting lines and words is cheaper than asking
the scanner to do it again, and `lineStarts` is exported so the two agree on what a line
is.

Nothing else about `analyze` is constrained. It may record problems (most grammars do),
and it may be expensive, because it runs once per text and its result is reused by
everything.

In a composite document each embedded language has an `analyze` of its own, called once
over its own region's content and nothing else, and its result is threaded to that
language's rules and hooks, so two languages never share a state.

## Diagnostics

Four sources feed one list, in this order:

1. the lexical pass — a vocabulary rejection, an unclosed region;
2. `checks`, run over the tokens;
3. `validate`, the grammar's own hook;
4. nothing else: `inspect()` then deduplicates and sorts.

In a composite document the same four run once per language, over that language's own
text, and `inspect` merges the results into the one list. Every diagnostic carries the
`id` of the grammar that raised it as its `source`, so a squiggle inside a fence says
which language is complaining.

Two rules can legitimately notice the same mistake, and drawing the underline twice makes
it darker rather than more informative. Duplicates are compared on position, code, and
message, so two different complaints about one word both survive. The list is sorted by
range.

### `checks`

| `CheckRule` field | Notes |
| --- | --- |
| `code` | Required. Copied onto every diagnostic the check raises |
| `severity` | Default `'error'` |
| `scopes` | The token scopes this check applies to. `'*'` matches every scope |
| `allow` | The words that are acceptable. A token in `scopes` whose text is not a member is reported. Any `WordsSource` will do |
| `message` | Required. `{word}` and `{allowed}` are substituted |
| `detail` | A second paragraph, shown under the message in a tooltip |
| `except` | A `RegExp` that skips tokens, so a check can carve out its exceptions |
| `perLine` | Runs at most once per line, on the first matching token |

Without `allow`, a check reports **every** token in `scopes` that `except` does not
skip:

```ts
checks: [
  {
    code: 'name-style',
    scopes: ['name', 'form.name'],
    except: /^[a-z][a-z0-9-]*$/,
    severity: 'warning',
    message: '"{word}" is not a lower-case name — write `email-address`, not `{word}`.',
  },
]
```

A `WordsSource` used as `allow` is resolved once per check with the grammar's
analysis, so a check may consult a vocabulary the machine supplied (`{ text, state }`,
as a `words` rule's source is). It still cannot report a range other than the token's
own, so keep checks to facts about a token's text and leave anything structural to
`validate`.

### `validate` and `report`

```ts
validate: (context) => {
  context.text       // the document
  context.tokens     // the painted tokens
  context.state      // whatever analyze returned
  context.report({ from, to, message, severity?, code?, detail? })
}
```

The grammar supplies the range, because only the grammar knows what the range
means. `severity` defaults to `'error'`, `code` to `'validate'`, and the
diagnostic's `source` is always the grammar's `id`.

`report` is also where a structural walk that ran in `analyze` publishes what it found:
record the ranges while the structure is known, and report them here. The usual
arrangement is that `analyze` decides what is wrong and `validate` hands the ranges over.

### Codes and severities

| Code | Where it comes from |
| --- | --- |
| `vocabulary:<id>` | A vocabulary's rejection; `unknownCode` changes it |
| `unknown-word` | A `words` rule's `unknown` with a message but no vocabulary to supply a code |
| `unclosed-region` | A region whose `end` was never found; `unclosed.code` changes it |
| *`<check.code>`* | A declarative check |
| `validate` | A `report` call with no code |

`Severity` is `'error' | 'warning' | 'info' | 'hint'`, four levels painted as
`litearea-diag-error`, `-warning`, `-info`, and `-hint`. One segment shows one squiggle:
the loudest diagnostic covering it wins. The wrapper also gains `litearea-invalid` and the
field `aria-invalid="true"` while any error is present.

## decorate

A token is what the *characters* are; a decoration is what they *mean*, and the two
change on different schedules.

```ts
decorate: (text, state) => readonly Decoration[]
```

A `Decoration` is `{ from, to, kind, title? }`: it is painted as `litearea-dec-<kind>`, and
`title` becomes the tooltip's title when the pointer rests on it, with the grammar's
`describe`, if there is one, still filling in the detail and the body. Decorations are
clamped into the document, dropped when they come out empty, and sorted.

A host's "in effect" mark is the worked case. `Geist Mono` is painted as a family from the
characters alone: that is a token. Which family is *in effect* depends on the host's
installed catalogue, so painting it as a token would mean re-lexing the document whenever
the catalogue changed; as a decoration it is one recomputed range list.

Reach for `decorate` when the mark depends on something outside the document. If nothing
in your language does, do not add one: a decoration that could have been a scope is a
second place for the same fact to live.

## describe and hover precedence

```ts
describe: (context) => HoverInfo | null | undefined
```

`HoverInfo` is `{ title?, detail?, body?, range?, kind? }`, all plain text. There
is no markdown rendering and no HTML: text that says `<b>` reaches the reader as a
literal `<b>`, not as a bold word.

`resolveHover(inspection, grammar, offset)` resolves one offset, and the
precedence is fixed:

| Order | Source | Why it is here |
| --- | --- | --- |
| 1 | A diagnostic covering the offset | The user resting the pointer on a squiggle is asking what is *wrong*, and answering "circle: a full disc" is technically true and useless. The **narrowest** covering diagnostic wins, so a squiggle inside a wider warning still explains itself |
| 2 | A decoration's `title` | The grammar went out of its way to name this range |
| 3 | The grammar's `describe` | The general account of a token |

The last two are not exclusive. When a decoration with a `title` covers the
offset, that title becomes the tooltip's title **and** the grammar's `describe`
still supplies the detail line (falling back to its own title) and the body. A
decoration title is short by design, `in effect: Geist Mono`, while a description is
rich but says nothing about the mark.

`diagnosticHover(diagnostic)` is exported so a host that shows its own marker list
can use the same wording: the severity as the title, the `source` as the detail,
and the message plus `detail` as the body.

In a composite document the third row is a chain rather than one grammar: `describe` is
asked innermost language first, and an outer language fills only a gap the inner one left.
Each is handed the whole document's `text`, `tokens`, and `diagnostics` (one spliced list)
but its own `state`, and the `word` it is offered is grown with its own `wordChars`. The
first two rows see every language at once: the narrowest diagnostic covering the offset
wins whoever raised it, and the decoration list is one list however many grammars produced
it.

The `HoverContext` a grammar's `describe` receives carries `text`, `offset`, `token`,
`word`, `line`, `tokens`, `diagnostics`, and `state`. The diagnostic under the offset is
not offered separately: a diagnostic outranks a description, so `describe` is only called
when nothing is wrong at that offset. A grammar that wants to know what else is flagged
reads `diagnostics`.

## A worked walkthrough

The language is the small form schema from the README, with the structural half
added. It is line-oriented and indentation-tolerant:

```
# the signup form
form signup
  text    email        required
  text    password     secret   "at least 12 characters"
  number  age          optional
  text    email        optional
  number  Weight       required
  bogus   color        required
```

### The vocabulary, declared once

```ts
import { defineGrammar, defineVocabulary, lineStarts } from '@citisen/litearea'
import type { Severity } from '@citisen/litearea'

const FIELD_TYPES = ['text', 'number', 'bool'] as const
const OPTION_WORDS = ['required', 'optional', 'secret'] as const

const TYPES = defineVocabulary({
  id: 'field-type',
  words: FIELD_TYPES,
  scope: 'field.type',
  unknownMessage: '"{word}" is not a field type — expected {allowed}.',
  docs: {
    text: { detail: 'one line of text', body: 'The only type that can be `secret`.' },
    number: { detail: 'a number', body: 'Kept as written, so `007` stays `007`.' },
    bool: { detail: 'yes or no' },
  },
})

const OPTIONS = defineVocabulary({
  id: 'option',
  words: OPTION_WORDS,
  scope: 'option',
  docs: {
    required: { detail: 'cannot be left empty' },
    optional: { detail: 'may be left empty' },
    secret: { detail: 'never shown again', body: 'Only a `text` field can be secret.' },
  },
})
```

### The structural pass

This walk decides what each row *is* and records what is wrong with it in the same pass:
the only reason to know which row a word belongs to is to say what a word that belongs to
nothing should have been.

```ts
interface Field {
  name: string
  type: string
  options: string[]
  line: number
  from: number
  to: number
}

interface Problem {
  from: number
  to: number
  message: string
  code: string
  severity: Severity
}

interface FormState {
  fields: Field[]
  problems: Problem[]
}

const analyze = (text: string): FormState => {
  const fields: Field[] = []
  const problems: Problem[] = []
  const starts = lineStarts(text)

  for (let index = 0; index < starts.length; index += 1) {
    const from = starts[index] ?? 0
    const raw = text.slice(from, starts[index + 1] ?? text.length)
    // The reader drops a comment from the first `#` anywhere on the line.
    const hash = raw.indexOf('#')
    const body = hash === -1 ? raw : raw.slice(0, hash)

    const words: Array<{ text: string; from: number; to: number }> = []
    const pattern = /[^\s]+/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(body)) !== null) {
      const at = from + match.index
      words.push({ text: match[0], from: at, to: at + match[0].length })
    }

    const type = words[0]
    const name = words[1]
    if (type === undefined || name === undefined) continue
    if (!FIELD_TYPES.includes(type.text as (typeof FIELD_TYPES)[number])) continue

    // A note is a quoted word, and the quotes belong to the syntax rather than to
    // the option list, so it is left out here.
    const options = words.slice(2).filter((word) => !word.text.startsWith('"'))
    fields.push({
      name: name.text,
      type: type.text,
      options: options.map((option) => option.text),
      line: index,
      from: name.from,
      to: name.to,
    })

    if (options.some((option) => option.text === 'secret') && type.text !== 'text') {
      problems.push({
        from: name.from,
        to: name.to,
        code: 'secret-not-text',
        severity: 'error',
        message: `\`${name.text}\` is \`${type.text}\`, so it cannot be \`secret\`.`,
      })
    }
  }

  const seen = new Set<string>()
  for (const field of fields) {
    if (seen.has(field.name)) {
      problems.push({
        from: field.from,
        to: field.to,
        code: 'duplicate-field',
        severity: 'error',
        message: `\`${field.name}\` is declared twice.`,
      })
    }
    seen.add(field.name)
  }

  return { fields, problems }
}
```

### The grammar

```ts
export const formSchema = defineGrammar({
  id: 'form-schema',
  name: 'form schema',
  wordChars: /[\p{L}\p{N}_-]/u,
  rules: [
    { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
    { kind: 'match', scope: 'keyword', pattern: /form/, when: { prevNot: '\\w' } },
    {
      kind: 'match',
      scope: 'form.name',
      pattern: /[A-Za-z][\w-]*/,
      when: { after: ['keyword'] },
    },
    { kind: 'words', words: TYPES, when: { firstOnLine: true }, unknown: {} },
    { kind: 'words', words: OPTIONS },
    { kind: 'match', scope: 'name', pattern: /[A-Za-z][\w-]*/, when: { after: ['field.type'] } },
    { kind: 'region', scope: 'note', begin: /"/, end: /"/, unclosed: { severity: 'warning' } },
    { kind: 'match', scope: 'invalid', pattern: /\S+/ },
  ],

  analyze,

  checks: [
    {
      code: 'name-style',
      scopes: ['name', 'form.name'],
      except: /^[a-z][a-z0-9-]*$/,
      severity: 'warning',
      message: '"{word}" is not a lower-case name — write `email-address`, not `{word}`.',
    },
  ],

  validate: (context) => {
    for (const problem of context.state.problems) context.report(problem)
  },

  compose: [
    {
      id: 'field-type',
      when: (context) => context.firstWord,
      range: (context) => context.word,
      items: () =>
        FIELD_TYPES.map((type) => ({
          label: type,
          append: '  ',
          kind: 'type',
          detail: TYPES.entryFor(type)?.detail,
          documentation: TYPES.entryFor(type)?.body,
        })),
    },
    {
      id: 'option',
      when: (context) =>
        context.tokens.some(
          (token) =>
            token.line === context.line.number &&
            token.scope === 'name' &&
            token.to <= context.caret,
        ),
      range: (context) => context.word,
      items: () =>
        OPTION_WORDS.map((word) => ({
          label: word,
          kind: 'option',
          detail: OPTIONS.entryFor(word)?.detail,
        })),
    },
  ],

  describe: (context) => {
    const token = context.token
    if (token === undefined) return undefined
    if (token.scope === 'comment') return { title: 'comment', body: 'Ignored by the reader.' }
    if (token.scope === 'note') return { title: 'note', body: 'Shown under the field.' }
    if (token.scope === 'invalid') {
      return { title: token.text, detail: 'not part of this language' }
    }
    const entry =
      token.scope === 'field.type' ? TYPES.entryFor(token.text) : OPTIONS.entryFor(token.text)
    return entry === undefined
      ? { title: token.text, detail: token.scope }
      : { title: token.text, detail: entry.detail, body: entry.body }
  },
})
```

### Reading each rule

| Rule | Why it is where it is |
| --- | --- |
| `comment` first | `#` is unambiguous, so it never needs to consult anything |
| `form` with `prevNot: '\\w'` | The keyword must not match the tail of a longer word, and the character class is what says so |
| `form.name` with `after: ['keyword']` | The name after `form` is free text, and `after` is the cheapest way to say "the token before me was the keyword" |
| `TYPES` with `firstOnLine: true` and `unknown: {}` | The first word of a row is a type or it is a mistake — the one place in this language where the lexical layer can be that sure. `unknown: {}` asks for the vocabulary's own message |
| `OPTIONS` with no `when` and no `unknown` | An option word may appear anywhere after a name and never rejects, so the rules below it still get their turn |
| `name` with `after: ['field.type']` | A field's name follows its type; putting the options above this rule means a field cannot be called `required`, which is a trade the language makes on purpose |
| the `note` region | Quotes make the body opaque, so a note containing the word `secret` is text and not an option. `unclosed` is a warning: the document still reads, it just reads further than intended |
| `invalid` last | Anything left is painted as a word this language does not know, so a typo is visible before the structural pass says anything about it |

### What the sample produces

| Where | Diagnostic |
| --- | --- |
| the second `email` | `duplicate-field`, error — from `validate`, reported with the range the walk recorded |
| `Weight` | `name-style`, warning — from `checks`, which sees only the token's own text |
| `bogus` | `vocabulary:field-type`, error — from the words rule's `unknown: {}` |

And three hovers: `note` over the quoted note, the field type's documentation over
`number`, and `Error` plus the rejection message over `bogus`. In the third, the
diagnostic outranks the token's description.

## What each hook may and may not do

| Hook | May | May not |
| --- | --- | --- |
| `rules` | Paint a scope, read the match's groups and `state`, look at position, and ask which region and which language it is in — `region`, `regions`, `depth`, `grammarId`, `beginGroups`, `beginText` | Ask which rule is running, see any token's final scope, or match the empty string |
| `analyze` | Read the whole text — its own region's content, when it belongs to an embedded language — be expensive, return anything typed | See the tokens (by design), paint, or see the document around its own region |
| `checks` | Test a token's text against a word set — including one resolved from the analysis — skip exceptions, fire once per line | Report a range other than the token's |
| `validate` | See the text, the tokens, and the state; report any range, code, and severity | Suppress a lexical diagnostic, or change the paint |
| `compose` | See the text, the caret, the tokens, the diagnostics, and the state; return any range and any rows | Choose who wins — that is `priority` and `merge`, and across languages a tie goes to the innermost — or apply an edit |
| `describe` | Read a token, a word, a line, and the state; return any text | Change the paint, or outrank a diagnostic — and an outer language answers only where the inner one had nothing to say |
| `decorate` | Return ranges, a kind, and a title | Change a token's scope, or clear a diagnostic |

A `grammar` region's hooks are the embedded grammar's own, run over its own region with
its own state. The outer grammar's `checks` and `validate` never see a token the embedded
paint produced, because they run before the splice; its `compose` and `describe` do see
the merged `tokens` and `diagnostics`.

Exceptions are not caught. A hook that throws propagates out of `inspect` (or
`complete`) into the caller, because a grammar that fails is a bug the host needs
to see.

## Error behaviour

| Situation | What the engine does |
| --- | --- |
| A rule's pattern can match the empty string | Treated as not matching, so the scan advances |
| A pattern was written without `y` or `g` | The sticky flag is added and the compiled pattern cached, so it cannot skip ahead |
| `wordChars` carries `g` or `y` | The flag is stripped, because `test` would otherwise alternate answers |
| `when.prevNot` at offset 0 | The predicate holds: a rule guarded this way is not disabled at the start of the document |
| A plain region's body | One opaque span, found in a single search; the rule list never runs inside it and an inner `begin` is not matched |
| A `nested` region's body | Opaque as well, but its own `begin` and `end` are matched at every position, so the delimiters pair off |
| A `transparent` region's body | The rule list runs inside it, and unclaimed characters are painted with the region's content scope |
| A `rules` region's body | Exactly the declared list runs inside it — plus the outer list after it, when the region is also `transparent` — and unclaimed characters are painted with the region's content scope |
| A `grammar` region's body | One opaque span in `scan`, reported in `ScanResult.embeds`; `inspect` then runs the embedded grammar over that content alone and splices its paint, diagnostics, and decorations back in at the region's offsets. `nested`, `transparent`, and `rules` are not read on the region |
| A `grammar` region's chooser returns `undefined` | The region is opaque: the outer rule list paints its content with `contentScope`, and no embedded language is recorded |
| A region's `end` is a function | Called once per frame, when the region opens, with its `RegionFrame`; the pattern it returns is used for that frame's whole life. `undefined` means the region never closes |
| A region declares `escapes` | A candidate closing delimiter preceded by an odd number of escape characters is not a close: the single search continues from the character after it, and a region on the stack refuses to close there |
| A region's `end` is never found, can match empty, or the `end` function returned `undefined` | The region runs to the end of the document and reports `unclosed` over its opening delimiter: a plain or `grammar` region when its search fails, a `nested`, `transparent`, or rule-carrying one when the document ends with a frame open, innermost frame first. An embedded language is still inspected over the content that is there |
| An `unclosed.scope` on a `nested`, `transparent`, `rules`, or `grammar` region | Ignored: only the plain fast path has one span to repaint, and an embedded language's content is repainted by the embedded grammar, so only `message`, `severity`, and `code` apply |
| A rule inside a `grammar` region asks `when.region`, or reads `match.region` / `beginGroups` | Answered from the embedded scanner's own stack, which starts empty: the frame that embedded the region is not on it, so the region predicates describe that language's own regions |
| A `words` rule does not match and has no `unknown` | The rule is skipped and the next rule is tried; no diagnostic |
| A `words` rule has `unknown` but no message anywhere | The token is painted with the unknown scope and **nothing** is reported |
| A member contains a character `wordChars` rejects | Matched literally, longest member first, after the word-run attempt — unless the rule sets `phrase`, which drops whitespace-containing members from that fallback so `max` stays a cap |
| A `words` rule rejects a word | Only the first word-shaped token is consumed |
| Several sources are eligible | The highest `priority` opens the list; equal priorities go to the innermost language at the caret first, then to the source declared first. An outer source with a higher explicit `priority` still wins |
| A list is already open | The source that answered keeps answering while its `when` holds, whatever the priorities say |
| Several diagnostics cover one range with the same code and message | One survives |
| A decoration falls outside the document | Clamped into it; when it comes out empty it is dropped |
| A hook throws | The exception propagates: `inspect` and `complete` do not catch |
