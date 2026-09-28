// ─── every live thing on the page ───────────────────────────────────────────
//
// A page declares a live editor by id — `specimen: { id: 'swatch' }` in the page record — and this
// is the one place that says what an id means. There are two of them left, because the playground
// is not a frame: it is the page it is on, and `mountPlayground` builds it.
//
// A frame that will not mount says so where it stands rather than disappearing. That matters more
// than it sounds: the failure this catches is a mistyped id in a page's record, and a page with a
// silently empty well in it is the kind of thing that ships.

import { swatchExample, themedExample } from './examples.js'
import { hostFor, type LiveHost } from './kit.js'
import { mountPlayground } from '../playground.js'

/** What the registry holds: something that mounts an editor into a well. */
type Factory = (host: LiveHost) => void

/** The id a page writes, and what it mounts. */
const EXAMPLES: Readonly<Record<string, Factory>> = {
  swatch: (host) => swatchExample(host),
  'swatch-themed': (host) => themedExample(host),
}

/** Say what went wrong, in the well. */
function report(frame: HTMLElement, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const body = frame.querySelector('[data-body]')
  const readout = frame.querySelector('[data-readout]')
  if (readout !== null) readout.textContent = `this example did not mount: ${message}`
  if (body !== null) {
    const note = document.createElement('p')
    note.className = 'bench-error'
    note.textContent = message
    body.replaceChildren(note)
  }
  console.error(error)
}

/**
 * Mount every live frame on the page, and the playground if this is its page.
 *
 * The count is written onto `<body>` as a data attribute, which is not for a reader: it is what
 * makes "every well on this page has an editor in it" a thing that can be checked from outside
 * the browser, in a headless run, without a screenshot.
 */
export function mountLiveFrames(): void {
  const frames = [...document.querySelectorAll<HTMLElement>('[data-live], [data-specimen]')]
  let mounted = 0
  let failed = 0

  for (const frame of frames) {
    const id = frame.dataset.live ?? frame.dataset.specimen ?? ''
    const factory = EXAMPLES[id]
    try {
      if (factory === undefined) throw new Error(`no example is registered as "${id}"`)
      factory(hostFor(frame))
      mounted += 1
    } catch (error) {
      failed += 1
      report(frame, error)
    }
  }

  document.body.dataset.liveMounted = `${mounted}/${frames.length}`
  if (failed > 0) {
    const summary = document.createElement('p')
    summary.className = 'live-noscript'
    summary.textContent = `${failed} of ${frames.length} live examples did not mount; see the console.`
    document.querySelector('.masthead')?.after(summary)
  }

  mountPlayground()
}
