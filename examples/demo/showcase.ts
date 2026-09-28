// ─── the showcase: the four things that arrived last ────────────────────────
//
// A standalone page beside the React demo, for looking at four features rather than
// reading about them:
//
//   1. sticky block headers, which need a document taller than the box to be visible
//      at all;
//   2. the inline completion preview, which needs a list open over a half-typed word;
//   3. the typing aids — pairs that close themselves, and the comment toggle;
//   4. embedded languages, which need a caret that can cross a fence: one Markdown
//      document hands each of its code blocks to a grammar of its own.
//
// Everything here is HOST code. The library ships no syntax, so the three grammars written
// below are the page's own, short enough to read — and the fourth is the composite Markdown
// beside this file, which the React demo mounts as well.
//
// The page mounts the VANILLA `createEditor` rather than the React binding. That is not
// a shortcut — it is the claim that the engine and the DOM layer are the library and a
// framework binding is optional, and it keeps this page to one file.

import {
  createEditor,
  defineGrammar,
  defineVocabulary,
  type Decoration,
  type Grammar,
  type LiteArea,
} from '@citisen/litearea'
import { COMPOSITE_DEFAULT, compositeGrammar } from './grammars/composite'
import './showcase.css'

const SHAPES = ['circle', 'square', 'rounded', 'arrow', 'line'] as const

// ── the sticky document's language ──────────────────────────────────────────
//
// Two kinds of block, nested: a `group` runs until the next group, and a `step` runs
// until the next step or group. Nested blocks are what stack more than one pinned row,
// so the document below is written to have both.

const PLAN_TEXT = [
  '# a plan, long enough that the box has to scroll',
  'group alpha',
  '  step one 10',
  '  step two 20',
  '  step three 30',
  '  step four 40',
  'group beta',
  '  step wire 1',
  '  step solder 2',
  '  step test 3',
  '  step ship 4',
  'group gamma',
  '  step sketch 7',
  '  step carve 8',
  '  step sand 9',
  '  step oil 10',
  'group delta',
  '  step pour 5',
  '  step cure 6',
].join('\n')

/** The offset each line starts at. */
function lineStartsOf(text: string): number[] {
  const starts = [0]
  for (let at = 0; at < text.length; at += 1) {
    if (text.charCodeAt(at) === 10) starts.push(at + 1)
  }
  return starts
}

/**
 * One range per block, which is all `decorate` has to return.
 *
 * A real language would compute this from its own analysis; here the rule is stated in
 * terms of the lines themselves so the page reads as the shape of a document rather
 * than as a parser.
 */
function planBlocks(text: string): readonly Decoration[] {
  const starts = lineStartsOf(text)
  const headsOf = (word: string): number[] =>
    starts
      .map((_, line) => line)
      .filter((line) => text.slice(starts[line] ?? 0, (starts[line] ?? 0) + word.length + 1) === `${word} `)

  const groups = headsOf('group')
  const steps = headsOf('step')
  const ranges: Decoration[] = []

  groups.forEach((line, index) => {
    const next = groups[index + 1]
    ranges.push({
      kind: 'block',
      from: starts[line] ?? 0,
      to: next === undefined ? text.length : (starts[next] ?? text.length) - 1,
    })
  })

  // A step ends at whichever comes first, the next step or the group it is in — which
  // is what keeps a step's range inside its group's range.
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

function planGrammar(): Grammar {
  return defineGrammar({
    id: 'plan',
    rules: [
      { kind: 'match', scope: 'keyword', pattern: /group|step/ },
      { kind: 'match', scope: 'number', pattern: /\d+/ },
      { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
      { kind: 'match', scope: 'name', pattern: /[a-z][\w-]*/ },
    ],
    comments: { line: '#' },
    decorate: (text) => planBlocks(text),
  })
}

// ── the completion preview's language ───────────────────────────────────────

const shapes = defineVocabulary({
  id: 'shape',
  words: SHAPES,
  scope: 'shape',
  // Deliberately quiet about a word that is not a member: this section is about the
  // preview of a half-typed word, and a squiggle under it would be the loudest thing on
  // a page that is trying to show something else.
  docs: {
    circle: { detail: 'a disc', body: 'Fixture documentation for circle.' },
    square: { detail: 'four corners' },
    rounded: { detail: 'a rounded box' },
    arrow: { detail: 'a line with a head' },
    line: { detail: 'a stroke' },
  },
})

function shapesGrammar(): Grammar {
  return defineGrammar({
    id: 'shapes',
    rules: [
      { kind: 'match', scope: 'keyword', pattern: /draw|fill/ },
      { kind: 'match', scope: 'number', pattern: /\d+/ },
      { kind: 'words', words: shapes },
    ],
    compose: [
      {
        id: 'shapes',
        range: (context) => context.word,
        items: () =>
          SHAPES.map((label) => ({
            label,
            append: ' ',
            kind: 'shape',
            detail: shapes.entryFor(label)?.detail,
            documentation: shapes.entryFor(label)?.body,
          })),
      },
    ],
  })
}

// ── the typing aids' language ───────────────────────────────────────────────

const AIDS_TEXT = [
  '{',
  '  name: "workbench",',
  '  size: 12,',
  '  # ctrl+/ toggles these markers',
  '  tags: [alpha, beta]',
  '}',
].join('\n')

function aidsGrammar(): Grammar {
  return defineGrammar({
    id: 'aids',
    rules: [
      { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
      { kind: 'match', scope: 'string', pattern: /"(?:[^"\\]|\\.)*"/ },
      { kind: 'match', scope: 'keyword', pattern: /true|false|null/ },
      { kind: 'match', scope: 'number', pattern: /-?\d+(?:\.\d+)?/ },
      { kind: 'match', scope: 'name', pattern: /[A-Za-z_][\w-]*/ },
      { kind: 'match', scope: 'punctuation', pattern: /[{}()[\],:]/ },
    ],
    // Typing any of these closes the pair. The quote is refused inside a string or a
    // comment, where it is a quotation mark and not a delimiter.
    pairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string', 'comment'] },
    ],
    comments: { line: '#', block: ['/*', '*/'] },
  })
}

// ── the page ────────────────────────────────────────────────────────────────

/** One section: what it is, what to try, and the live editor. */
interface Section {
  title: string
  blurb: string
  tries: readonly string[]
  /** Mount an editor into the host, and return the editor so it can be replaced. */
  mount: (host: HTMLElement) => LiteArea
  /** Whether the section offers an inline-preview switch. */
  toggle?: boolean
  /**
   * Paint the readout under the editor: what the document embeds, and who complained.
   *
   * The page owns the container and calls this once after mounting and again on every
   * input, so a section says what its grammar has to report and the editor says when it
   * has something new to report. The container's children are replaced.
   */
  readout?: (editor: LiteArea, target: HTMLElement) => void
}

const SECTIONS: readonly Section[] = [
  {
    title: '1 · Sticky block headers',
    blurb:
      'The box is clamped to seven rows, so the document scrolls. A group header stays pinned at the top for as long as you are inside that group, and a step header stacks underneath it — one row per level of nesting.',
    tries: [
      'The box starts scrolled a little, so the pinned header is on screen already.',
      'Scroll inside the box (the wheel, or drag the scrollbar).',
      'Watch the pinned row change as you cross from group to group.',
      'Click into the text: the pinned rows take no pointer events, so the caret still lands where you click.',
    ],
    mount: (host) => {
      const editor = createEditor(host, {
        grammar: planGrammar(),
        value: PLAN_TEXT,
        sizing: { minRows: 7, maxRows: 7 },
        completion: false,
        sticky: { kinds: ['block'] },
      })
      // Scrolled past the comment line and into the first group, so the feature is on
      // screen the moment the page loads rather than after the reader works out that
      // this box scrolls. It is an ordinary programmatic scroll: no selection is touched
      // and no text is written.
      //
      // It waits a frame because the box's height is written by the editor's FIRST
      // measurement, which happens after construction — scrolling before that is
      // scrolling an element whose height is still the placeholder one, and the browser
      // puts the offset back when the real height arrives.
      requestAnimationFrame(() => {
        editor.input.scrollTop = 44
      })
      return editor
    },
  },
  {
    title: '2 · Inline completion preview',
    blurb:
      'The list still opens; the preview is the part of the active row that is not typed yet, drawn as an opaque chip exactly where the next character would land. Arrowing through the list moves the preview.',
    tries: [
      'Type “cir” — the preview completes it, and Tab accepts it with the trailing space.',
      'Press ArrowDown: the preview follows the active row.',
      'Type “rd” and watch: “rounded” is offered but nothing is previewed, because its insertion does not begin with what you typed.',
      'Accept something, then press Ctrl+Z: one edit, one undo.',
    ],
    mount: (host) => {
      const editor = createEditor(host, {
        grammar: shapesGrammar(),
        value: 'draw cir',
        completion: { inline: true },
        hover: { enabled: true, delay: 120 },
        sizing: { minRows: 3, maxRows: 8 },
      })
      editor.focus()
      editor.setSelection(editor.value.length)
      editor.showCompletions()
      return editor
    },
    toggle: true,
  },
  {
    title: '3 · Typing aids',
    blurb:
      'The grammar declares its delimiters and its comment markers; the editor maintains them while you type. Every edit it makes on your behalf goes through the browser’s editing pipeline, so one Ctrl+Z takes it back.',
    tries: [
      'Type “{”, “[”, “(” or “” ” — the pair closes itself with the caret inside.',
      'Select some text and type a delimiter: the selection is wrapped and stays selected.',
      'Type “}” right before an existing “}”: nothing is written, the caret steps over it.',
      'Put the caret between “{” and “}” and press Enter: an indented block opens.',
      'Press Ctrl+/ on a line, then again: the marker goes on and comes back off.',
      'Select several lines and press Ctrl+] to indent them, Ctrl+[ to take it back — one Ctrl+Z undoes the whole block.',
      'Press Ctrl+Z after any of those: the whole edit goes back as one.',
    ],
    mount: (host) =>
      createEditor(host, {
        grammar: aidsGrammar(),
        value: AIDS_TEXT,
        sizing: { minRows: 6, maxRows: 16 },
        indent: { unit: 2 },
        // Tab is deliberately NOT bound here: it is how a reader leaves a form, and an
        // editor that takes it turns every field into a keyboard trap. `Tab` and
        // `Shift+Tab` are two lines for a host that wants them:
        //
        //     { key: 'Tab', command: 'indent' },
        //     { key: 'Shift+Tab', command: 'outdent' },
        keys: [
          { key: 'Mod+]', command: 'indentLines' },
          { key: 'Mod+[', command: 'outdentLines' },
        ],
      }),
  },
  {
    title: '4 · Embedded languages',
    blurb:
      'One Markdown document, four languages, and a fence as the door between them. The outer grammar hands each block to the grammar its info string names — `json`, `js`, `html`, `css` — and HTML embeds two of the others in turn, so the script in the HTML fence is a language inside a language; a fence naming a language nobody registered stays an ordinary fence rather than an error. Inside a block the paint, the completion, the hover, the pair that closes itself, and the marker Ctrl+/ writes all belong to the embedded language.',
    tries: [
      'Put the caret inside the js block and press Ctrl+/: the marker is JavaScript’s //, not the <!-- --> the Markdown around it would use.',
      'Type “cons” inside the js block and accept the keyword; then type “## ” at the start of a line outside every fence.',
      'Type “(” inside the js block and it closes itself, because the pairs at the caret are JavaScript’s; the same keystroke in the Markdown between the fences writes a bare paren.',
      'Hover a JSON key inside the fence, then the fence opener around it: two languages answer, and neither knows the other’s words.',
      'Read the lists under the editor: every embedded language with its depth and the info string that opened it, then each problem with the language that raised it.',
    ],
    mount: (host) =>
      createEditor(host, {
        grammar: compositeGrammar(),
        value: COMPOSITE_DEFAULT,
        sizing: { minRows: 16, maxRows: 30 },
        completion: { auto: true },
        hover: { enabled: true, delay: 120 },
      }),
    readout: embeddedReadout,
  },
]

/** A paragraph of text. */
function paragraph(className: string, text: string): HTMLParagraphElement {
  const element = document.createElement('p')
  element.className = className
  element.textContent = text
  return element
}

/** The list of things worth trying in a section. */
function tryList(tries: readonly string[]): HTMLUListElement {
  const list = document.createElement('ul')
  list.className = 'tries'
  for (const item of tries) {
    const entry = document.createElement('li')
    entry.textContent = item
    list.appendChild(entry)
  }
  return list
}

/** A small caption above one list of a readout. */
function caption(text: string): HTMLHeadingElement {
  const heading = document.createElement('h3')
  heading.textContent = text
  return heading
}

/**
 * The readout for the composite section: what the document embeds, and who complained.
 *
 * It reads the editor's own `inspection` — the same object the paint was built from — so
 * the lists and the colour cannot disagree about which text they describe. Rebuilding them
 * whole on every report is the honest thing at this size: a handful of rows, and a diff
 * between two of them would be an analysis to keep in step with the editor's own.
 * @param editor - the editor to read.
 * @param target - the page's container, whose children are replaced.
 */
function embeddedReadout(editor: LiteArea, target: HTMLElement): void {
  const inspection = editor.inspection
  if (inspection === undefined) {
    target.replaceChildren(paragraph('blurb', 'waiting for the first inspection…'))
    return
  }

  const problems = document.createElement('ul')
  problems.className = 'diagnostics'
  for (const diagnostic of inspection.diagnostics) {
    const entry = document.createElement('li')
    // Who raised it: `json`, `javascript`, `html`, or `css` for a problem inside a block,
    // and `composite` for one about the Markdown around them.
    const source = document.createElement('code')
    source.textContent = diagnostic.source ?? '—'
    const severity = document.createElement('span')
    severity.className = 'depth'
    severity.textContent = diagnostic.severity
    const message = document.createElement('span')
    message.textContent = diagnostic.message
    entry.append(source, severity, message)
    problems.appendChild(entry)
  }

  const languages = document.createElement('ul')
  languages.className = 'languages'
  for (const span of inspection.languages) {
    const entry = document.createElement('li')
    const id = document.createElement('code')
    id.textContent = span.id
    // How many embedded languages enclose this one: 1 is a language the document itself
    // embeds, and 2 is a language an embedded language embeds.
    const depth = document.createElement('span')
    depth.className = 'depth'
    depth.textContent = `depth ${String(span.depth)}`
    // The info string, which is `groups[1]` of the fence's own `begin` — empty for a fence
    // that named nothing, which is also how a language nobody registered is spelled.
    const info = document.createElement('span')
    info.textContent = span.groups[1] ?? '—'
    entry.append(id, depth, info)
    languages.appendChild(entry)
  }

  const nothing = (text: string): HTMLLIElement => {
    const entry = document.createElement('li')
    entry.className = 'blurb'
    entry.textContent = text
    return entry
  }

  target.replaceChildren(
    caption('Who complained, and about what'),
    problems.childElementCount === 0 ? nothing('no problems') : problems,
    caption('Embedded languages, in document order'),
    languages.childElementCount === 0 ? nothing('none') : languages,
  )
}

const host = document.getElementById('showcase')
if (host === null) throw new Error('the showcase needs a #showcase element')

const header = document.createElement('header')
header.innerHTML =
  '<h1>litearea — four features</h1>' +
  '<p>The vanilla <code>createEditor</code>, bound four times over the four grammars below. ' +
  'Each grammar is the page’s own: the library ships no syntax.</p>'
host.appendChild(header)

for (const section of SECTIONS) {
  const element = document.createElement('section')
  const title = document.createElement('h2')
  title.textContent = section.title
  element.append(title, paragraph('blurb', section.blurb), tryList(section.tries))

  const mountPoint = document.createElement('div')
  mountPoint.className = 'binding'
  element.appendChild(mountPoint)

  let editor = section.mount(mountPoint)

  if (section.toggle === true) {
    const controls = document.createElement('label')
    controls.className = 'switch'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = true
    const text = document.createElement('span')
    text.textContent = 'inline preview (remounts the editor, because the option is read at mount)'
    box.addEventListener('change', () => {
      // `completion` is read when the editor mounts, so the switch rebuilds it — and the
      // page says so, because that is a real property of the options and not a quirk of
      // this switch.
      const inline = box.checked
      editor.destroy()
      mountPoint.replaceChildren()
      editor = createEditor(mountPoint, {
        grammar: shapesGrammar(),
        value: 'draw cir',
        completion: { inline },
        hover: { enabled: true, delay: 120 },
        sizing: { minRows: 3, maxRows: 8 },
      })
      editor.focus()
      editor.setSelection(editor.value.length)
      editor.showCompletions()
    })
    controls.append(box, text)
    element.appendChild(controls)
  }

  const paint = section.readout
  if (paint !== undefined) {
    const readout = document.createElement('div')
    readout.className = 'readout'
    element.appendChild(readout)
    const fill = (): void => {
      paint(editor, readout)
    }
    // The editor's own `input` listener is the one that inspects the new text and it was
    // registered when the editor mounted, so by the time this one runs, `editor.inspection`
    // already describes what is on screen. That is what makes the readout a copy of the
    // editor's analysis rather than a second opinion about the same text.
    editor.input.addEventListener('input', fill)
    fill()
  }

  host.appendChild(element)
}

const footer = document.createElement('footer')
footer.textContent =
  'All four sections drive the same editor. Its document belongs to the browser, the library only reads it, and every edit the editor makes is one undoable edit.'
host.appendChild(footer)
