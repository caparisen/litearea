// ─── the examples the playground runs ───────────────────────────────────────
//
// Every language on the site is a real file that the page evaluates, and nothing else checks it:
// the files are JavaScript rather than TypeScript precisely so that they can be evaluated in a
// browser, which also means `tsc` never reads one. So this test does what the type checker would
// have done, and one thing it could not have: it runs each source, reads a document with the
// language that came out, and checks that the language is one that does something.
//
// The last part is the one worth having. An example whose own document never reaches the rules it
// exists to demonstrate still evaluates, still paints plain text, and still looks finished on the
// page — which is exactly how the two bugs this file caught had shipped.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as library from '../src/index.js'
import { inspect } from '../src/index.js'
import { run } from '../site/pages/assets/examples/run.js'

const DIRECTORY = fileURLToPath(new URL('../site/pages/assets/examples/', import.meta.url))

/** The library as `run` hands it to a source, which is the whole surface a source can reach. */
const API = library as unknown as Record<string, unknown>

/** Every editor option `playground.ts` passes on from a source. Anything else is silently lost. */
const EDITOR_OPTIONS = new Set([
  'className',
  'completion',
  'decorations',
  'hover',
  'indent',
  'keys',
  'placeholder',
  'readOnly',
  'spellCheck',
  'sticky',
  'variables',
])

/** The files, in a stable order, so a failure names the language it is about. */
const SOURCES = readdirSync(DIRECTORY)
  .filter((name) => name.endsWith('.js'))
  .sort()

/** The text of one source, exactly as the page imports it. */
function sourceOf(name: string): string {
  return readFileSync(join(DIRECTORY, name), 'utf8')
}

/** One source, run. */
function exampleOf(name: string): ReturnType<typeof run> {
  return run(sourceOf(name), API)
}

describe('the example sources', () => {
  it('is one file per language the page offers', () => {
    expect(SOURCES).toEqual(['aids.js', 'families.js', 'form-schema.js', 'mini-conf.js', 'plan.js', 'swatch.js'])
  })

  for (const name of SOURCES) {
    describe(name, () => {
      const example = exampleOf(name)
      const text = example.sample ?? ''

      it('ships a document', () => {
        expect(typeof example.sample).toBe('string')
        expect(text.trim()).not.toBe('')
      })

      it('paints that document', () => {
        const inspection = inspect(text, example.grammar)
        const painted = inspection.tokens.filter((token) => token.text.trim() !== '')
        expect(painted.length).toBeGreaterThan(0)
        // A token outside the document is a rule that read past its end, which is the failure that
        // shows up as a colour sliding off a character rather than as an exception.
        expect(painted.every((token) => token.from >= 0 && token.to <= text.length)).toBe(true)
      })

      it('asks for editor options that exist', () => {
        for (const key of Object.keys(example.options)) expect(EDITOR_OPTIONS).toContain(key)
      })

      it('fits the pane it is read in', () => {
        // The source pane of the playground fits a hundred characters at a 1512px window, measured
        // in the browser, and about ninety-eight once its own scrollbar is showing. Ninety-six is
        // the number with room to spare, and it is not a style preference: a line that wraps in
        // that pane is a line the reader has to reassemble, which is the one thing an editor of
        // source is for. Long objects are written one property to a line to stay inside it.
        for (const [index, line] of sourceOf(name).split('\n').entries()) {
          expect(line.length, `${name}:${String(index + 1)} is ${String(line.length)} columns`).toBeLessThanOrEqual(96)
        }
      })
    })
  }

  // The two languages whose whole point is a thing the document has to reach: a key inside a block,
  // and a block inside a block. Both were broken when the examples moved onto this page, and both
  // failed silently — the file still ran, and the preview still painted.
  it('reaches the keys inside mini conf’s block', () => {
    const example = exampleOf('mini-conf.js')
    const scopes = new Set(inspect(example.sample ?? '', example.grammar).tokens.map((token) => token.scope))
    expect(scopes.has('key')).toBe(true)
    expect(scopes.has('value')).toBe(true)
  })

  it('nests a step inside a group in plan', () => {
    const example = exampleOf('plan.js')
    const ranges = inspect(example.sample ?? '', example.grammar).decorations
    expect(ranges.length).toBeGreaterThan(8)
    expect(
      ranges.some((inner) =>
        ranges.some((outer) => inner !== outer && inner.from > outer.from && inner.to <= outer.to),
      ),
    ).toBe(true)
  })
})
