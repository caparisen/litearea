// ─── the examples, in the order the page offers them ────────────────────────
//
// One file per language, and this is the list of them. A source is imported as TEXT rather than as
// a module — Vite's `?raw` — and that is what lets the page edit it: what runs is what the reader
// is looking at, and there is no second copy of a language to drift from the first.
//
// Adding an example is a file in this directory and a line here. The file is a module that exports
// `grammar`, `sample`, and `options`; `run.ts` is what that means and how it is read.

import aidsSource from './aids.js?raw'
import familiesSource from './families.js?raw'
import formSchemaSource from './form-schema.js?raw'
import miniConfSource from './mini-conf.js?raw'
import planSource from './plan.js?raw'
import swatchSource from './swatch.js?raw'

/** One example: the file, and what the list calls it. */
export interface Example {
  /** The file's name without its extension. */
  id: string
  /** What the page shows in the list. Lower case, because every language here is a language and
   *  not a product, and a name that is a heading on a page is not a name in a menu. */
  name: string
  /** The whole file, which is also what the editor starts with. */
  source: string
}

/** The examples, in the order they are read: the front page's language first, and the rest after. */
export const EXAMPLES: readonly Example[] = [
  { id: 'swatch', name: 'swatch', source: swatchSource },
  { id: 'form-schema', name: 'form schema', source: formSchemaSource },
  { id: 'mini-conf', name: 'mini conf', source: miniConfSource },
  { id: 'plan', name: 'sticky headers', source: planSource },
  { id: 'aids', name: 'typing aids', source: aidsSource },
  { id: 'families', name: 'completion', source: familiesSource },
]
