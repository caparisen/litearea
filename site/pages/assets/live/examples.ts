// ─── the two live editors that are not the playground ───────────────────────
//
// The front page pins a swatch editor beside its prose, and the theming page pins two editors
// showing one grammar in two faces. Both read the language out of `examples/swatch.js` — the same
// file the playground shows and edits — by RUNNING it, because a language whose source the site
// shows has to be the language the site runs, and a second copy of it is a copy that drifts.
//
// What a page shows is the language. This file is the plumbing that puts it in a box and reports
// what it says, which is why it is short.

import { createEditor, type Diagnostic } from '@citisen/litearea'
import * as litearea from '@citisen/litearea'
import swatchSource from '../examples/swatch.js?raw'
import { run } from '../examples/run.js'
import { escapeHtml, lines, type LiveHost } from './kit.js'

/** The colours the theming page's pair is read against: the file's own, kept short. */
const SWATCH_TEXT = lines('red circle 20', 'teal square 40', '')

/**
 * The problem list, in one line.
 *
 * The first problem is spelled out and the rest are counted, because a readout is small print under
 * a box rather than a second copy of the editor's own diagnostics panel.
 *
 * @param diagnostics - what the editor reported.
 * @returns HTML, already escaped.
 */
function problems(diagnostics: readonly Diagnostic[]): string {
  if (diagnostics.length === 0) return '<b>no problems</b>'
  const [first] = diagnostics
  if (first === undefined) return '<b>no problems</b>'
  const more = diagnostics.length > 1 ? ` and ${diagnostics.length - 1} more` : ''
  return `<b>${escapeHtml(first.code ?? 'problem')}</b> · ${escapeHtml(first.message)}${more}`
}

/** What `examples/swatch.js` declares, run the way the playground runs it. */
function swatch(): ReturnType<typeof run> {
  return run(swatchSource, litearea as unknown as Record<string, unknown>)
}

/** The front page's language, with its own document and its own readout. */
export function swatchExample(host: LiveHost): void {
  const language = swatch()
  const document = language.sample ?? ''
  const editor = createEditor(host.body, {
    grammar: language.grammar,
    value: document,
    sizing: { minRows: 4, maxRows: 16 },
    hover: { enabled: true, delay: 120 },
    // Every editor on the site is a real form control, so every one of them has a name. It is the
    // only thing a screen reader can announce about a box whose visual label is a bar above it.
    ariaLabel: 'A swatch document',
    onDiagnostics: (diagnostics) => host.readout(problems(diagnostics)),
  })
  host.button('reset', 'reset', () => {
    editor.setValue(document, true)
    editor.focus()
  })
}

/**
 * The theming page: one grammar, two editors, two faces.
 *
 * The point is the thing `variables` exists for and a stylesheet cannot do — two editors on one
 * page with different faces — so the specimen is two mounts rather than one, and the second one is
 * a proportional serif with a different accent, which is also the honest answer to "does the
 * highlight still line up": it does, because the layer, the field, and the mirror all read the same
 * computed font.
 */
export function themedExample(host: LiveHost): void {
  const pair = document.createElement('div')
  pair.className = 'live-pair'
  host.body.append(pair)

  const plain = document.createElement('div')
  const styled = document.createElement('div')
  pair.append(plain, styled)

  const grammar = swatch().grammar

  createEditor(plain, {
    grammar,
    value: SWATCH_TEXT,
    sizing: { minRows: 2, maxRows: 8 },
    completion: false,
    ariaLabel: 'A swatch document, default theme',
  })

  createEditor(styled, {
    grammar,
    value: SWATCH_TEXT,
    sizing: { minRows: 2, maxRows: 8 },
    completion: false,
    ariaLabel: 'A swatch document, custom theme',
    variables: {
      font: 'Georgia, "Times New Roman", serif',
      'font-size': '16px',
      'line-height': '26px',
      'padding-block': '10px',
      'padding-inline': '14px',
      radius: '10px',
      // The theme is complete on purpose: a host that sets three properties inherits the rest from
      // the stylesheet — which is the behaviour worth knowing — but a specimen set in the site's own
      // ink-mode colours on a cream ground would be a demonstration of nothing.
      '--litearea-fg': '#2b2318',
      '--litearea-fg-dim': '#8a7f6b',
      '--litearea-bg': '#fdfbf5',
      '--litearea-bg-raised': '#fdfbf5',
      '--litearea-border': '#ded3bd',
      '--litearea-border-focus': '#1d4ed8',
      'scope-swatch-color': '#7c2d12',
      'scope-swatch-shape': '#1d4ed8',
      accent: '#1d4ed8',
    },
  })

  host.readout('the one below is themed entirely through <b>variables</b>')
}
