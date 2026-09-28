// ─── the playground: one file, and what it does ─────────────────────────────
//
// Three things on one page. A list at the top picks an example; the left editor is that example's
// WHOLE file, editable; the right one is a document read with whatever the left one currently says.
//
// There is no apply button, and there is no "try this" list beside the code. The grammar is
// re-evaluated a moment after the reader stops typing, so an edit and its effect are the same
// gesture — and what used to be a list of things to try is a comment in the file, which is where a
// reader who is about to try something is already looking.
//
// Two decisions are worth knowing about:
//
//   - The document editor is handed a LIVE VIEW of the grammar rather than the grammar itself —
//     the same trick the React binding uses — so a new language is picked up by `refresh()` without
//     the editor being rebuilt, and the reader's undo history survives an edit to the source.
//   - The preview is remounted only when the OPTIONS change. `completion`, `sticky`, and the key
//     bindings are read when an editor mounts, so a file that edits one needs a new editor; a file
//     that edits a rule does not, and remounting on every keystroke would throw away the caret and
//     the undo stack of the document beside it.
//
// A source that does not run is the most likely thing to happen here, and it must not take the page
// with it: the last language that ran stays in force, and the file that failed is marked.

import * as litearea from '@citisen/litearea'
import { createEditor, type Grammar, type LiteArea } from '@citisen/litearea'
import { dslGrammar } from './dsl.js'
import { EXAMPLES, type Example } from './examples/index.js'
import { run, type ExampleModule } from './examples/run.js'

/** What the page keeps between keystrokes. */
interface Bench {
  /** The language in force, behind the live view the document editor holds. */
  holder: { current: Grammar }
  /** The options the preview was mounted with, serialized: they are read at mount. */
  mounted: string
  source: LiteArea
  preview: LiteArea | undefined
}

/** One element, with a class and text, in one call. */
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className !== undefined) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * A view of an object that always reads the newest value.
 * @param holder - the box holding the current grammar.
 * @returns the live view the editor is constructed with.
 */
function liveGrammar(holder: { current: Grammar }): Grammar {
  return new Proxy({} as Grammar, {
    get: (_target, key) => Reflect.get(holder.current as object, key),
    has: (_target, key) => Reflect.has(holder.current as object, key),
    ownKeys: () => Reflect.ownKeys(holder.current as object),
    getOwnPropertyDescriptor: (_target, key) => Reflect.getOwnPropertyDescriptor(holder.current as object, key),
  }) as Grammar
}

/**
 * How much room the bench may take.
 *
 * The bench is the page, so it is sized to what is left of the window under the masthead — but the
 * page has a title and a sentence above it as well, and that is not a constant: a title wraps on
 * one screen and not on another, and a web font arriving late moves every line of it. So the space
 * above the bench is MEASURED rather than assumed, and published as `--bench-lead` for the
 * stylesheet to subtract.
 *
 * @param host - the bench element.
 */
function watchLead(host: HTMLElement): void {
  const measure = (): void => {
    const lead = Math.min(Math.max(host.offsetTop, 120), 340)
    host.style.setProperty('--bench-lead', `${String(Math.round(lead))}px`)
  }
  measure()
  window.addEventListener('resize', measure, { passive: true })
  void document.fonts?.ready.then(measure)
  const prose = host.closest('.prose')
  if (prose !== null && typeof ResizeObserver === 'function') {
    new ResizeObserver(measure).observe(prose)
  }
}

/** Build the bench, mount both editors, and load the first example. */
function build(host: HTMLElement): void {
  const first = EXAMPLES[0]
  if (first === undefined) return

  const sourceHost = element('div', 'bench-pane')
  const previewHost = element('div', 'bench-pane')
  sourceHost.dataset.pane = 'source'
  previewHost.dataset.pane = 'preview'

  const bar = element('div', 'bench-bar')
  const select = element('select')
  select.setAttribute('aria-label', 'Example')
  for (const example of EXAMPLES) {
    const option = element('option', undefined, example.name)
    option.value = example.id
    select.append(option)
  }
  // The one mark the page has. A source that does not run leaves the last one that did in force,
  // and this says so without spending a line of prose on it: the square carries the message in its
  // tooltip, where a reader who wants it can find it and a reader who does not is not told.
  const mark = element('span', 'bench-mark')
  mark.hidden = true
  bar.append(select, mark)

  const split = element('div', 'bench-split')
  split.append(sourceHost, previewHost)
  host.append(bar, split)
  watchLead(host)

  const bench: Bench = {
    holder: { current: { id: 'empty', rules: [] } },
    mounted: '',
    source: undefined as unknown as LiteArea,
    preview: undefined,
  }

  /** Say that the source does not run, and why, in the mark's tooltip. */
  const flag = (error: unknown): void => {
    mark.hidden = false
    mark.title = error instanceof Error ? error.message : String(error)
  }

  const clear = (): void => {
    mark.hidden = true
    mark.title = ''
  }

  /** Evaluate a source, or report it and keep the language that is already in force. */
  const evaluate = (text: string): ExampleModule | undefined => {
    try {
      return run(text, litearea as unknown as Record<string, unknown>)
    } catch (error) {
      flag(error)
      return undefined
    }
  }

  /** Mount the preview with a language and a document. The options are read here and nowhere else. */
  const mountPreview = (module: ExampleModule, text: string): void => {
    bench.holder.current = module.grammar
    bench.mounted = JSON.stringify(module.options)
    bench.preview?.destroy()
    bench.preview = createEditor(previewHost, {
      ...module.options,
      grammar: liveGrammar(bench.holder),
      value: text,
      hover: { enabled: true, delay: 120 },
      // The pane owns the height: see `.bench-pane` in the stylesheet. An editor that grows with
      // its content would make the two panes different heights, and the page is one instrument.
      sizing: { autoGrow: false },
      ariaLabel: 'A document in this language',
    })
  }

  /** Load one example: its whole file on the left, its own document on the right. */
  const load = (example: Example): void => {
    bench.source.setValue(example.source, false)
    clear()
    const module = evaluate(example.source)
    if (module === undefined) return
    mountPreview(module, module.sample ?? '')
  }

  let pending = 0

  bench.source = createEditor(sourceHost, {
    grammar: dslGrammar,
    value: first.source,
    sizing: { autoGrow: false },
    indent: { unit: 2 },
    hover: { enabled: true, delay: 140 },
    ariaLabel: 'The language, as source',
    onChange: (text) => {
      window.clearTimeout(pending)
      pending = window.setTimeout(() => {
        const module = evaluate(text)
        if (module === undefined) return
        clear()
        bench.holder.current = module.grammar
        const options = JSON.stringify(module.options)
        // The document is left exactly as the reader has it: an edit to a rule is not an edit to
        // the text being read, and replacing one would be the editor taking the reader's work away.
        if (options === bench.mounted) bench.preview?.refresh()
        else mountPreview(module, bench.preview?.value ?? module.sample ?? '')
      }, 120)
    },
  })

  select.addEventListener('change', () => {
    const next = EXAMPLES.find((candidate) => candidate.id === select.value)
    if (next !== undefined) load(next)
  })

  load(first)
}

/** Mount every bench on the page. There is one, and there is no reason for there to be two. */
export function mountPlayground(): void {
  for (const host of document.querySelectorAll<HTMLElement>('[data-bench]')) {
    try {
      build(host)
    } catch (error) {
      host.textContent = `the playground could not start: ${error instanceof Error ? error.message : String(error)}`
      console.error(error)
    }
  }
}
