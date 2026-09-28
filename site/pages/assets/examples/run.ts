// ─── run: one example file, as a module ─────────────────────────────────────
//
// The playground evaluates a file's TEXT rather than importing it, and that is the whole mechanism
// of it: an import is resolved once by the bundler and a reader cannot edit one. Two things follow,
// and they are the whole of this file.
//
//   - An `import` is taken off the text and its names are handed to the function as PARAMETERS, so
//     a source reaches `@citisen/litearea` and nothing else on the page. That is as close as a
//     browser gets to sandboxing an `eval`, and it is why the library is passed in here rather
//     than reached for: the same call with a different namespace is a different language set.
//   - `export` is taken off, because a function body has nothing to export to. The names the file
//     declared are collected instead, so the page can find `grammar`, `sample`, and `options`
//     again.
//
// A source that does not run THROWS, and the caller keeps the last language that did. A syntax
// error is the most likely thing to happen in an editor like this one and it must not take the
// page with it.
//
// Declarations are read at the START of a line and only there. An indented `const` belongs to a
// function body, and collecting one would put a name in the result that the module never declared.

import type { Grammar, LiteAreaOptions } from '@citisen/litearea'

/**
 * What a source may say about the editor that reads it.
 *
 * It is deliberately a short list. `grammar`, `value`, and `sizing` belong to the page — the page
 * is what knows which language is being read and how much room there is — while these are
 * properties of the language itself that a host would otherwise have to restate.
 */
export type ExampleOptions = Partial<
  Pick<
    LiteAreaOptions,
    'completion' | 'hover' | 'sticky' | 'indent' | 'keys' | 'decorations' | 'placeholder' | 'readOnly' | 'spellCheck' | 'variables' | 'className'
  >
>

/** What a source file yields once it has run. */
export interface ExampleModule {
  /** The language: the file's `grammar`, built if it is a function. */
  grammar: Grammar
  /** A document written in the language, if the file carries one. */
  sample: string | undefined
  /** What the editor needs beyond the grammar. Empty when the file says nothing. */
  options: ExampleOptions
}

/** One name an import binds: what it is called here, and what it is called in the library. */
interface ImportedName {
  exported: string
  local: string
}

/** The one specifier a source may import from. Anything else needs a bundler, not an editor. */
const LIBRARY = '@citisen/litearea'

/** A statement that takes names from a module, at the start of a line and on one line. */
const IMPORT = /^[ \t]*import\s+([^'"]*?)\s*from\s*['"]([^'"]+)['"][ \t]*;?[ \t]*$/gm

/** A top-level declaration. Indentation is NOT allowed: see the note at the top of the file. */
const DECLARED = /^(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm

/**
 * The names one import clause binds.
 * @param clause - what stands between `import` and `from`, without the braces.
 * @returns one entry per name, with any `as` already resolved.
 */
function namesOf(clause: string): ImportedName[] {
  const trimmed = clause.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    throw new Error(`an import has to be written \`import { name } from '${LIBRARY}'\``)
  }
  return trimmed
    .slice(1, -1)
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const [exported = '', local] = part.split(/\s+as\s+/)
      return { exported: exported.trim(), local: (local ?? exported).trim() }
    })
}

/**
 * Run one source file against one library.
 *
 * @param source - the file's text.
 * @param library - what the file may import from, keyed by export name.
 * @returns the language, the document it ships with, and what the editor needs to know.
 */
export function run(source: string, library: Record<string, unknown>): ExampleModule {
  const imported: ImportedName[] = []

  const stripped = source.replace(IMPORT, (_whole, clause: string, specifier: string) => {
    if (specifier !== LIBRARY) {
      throw new Error(`this page can only run a file that imports from ${LIBRARY}; "${specifier}" needs a bundler`)
    }
    imported.push(...namesOf(clause))
    return ''
  })

  const body = stripped.replace(/^[ \t]*export\s+/gm, '')
  const declared = [...new Set([...body.matchAll(DECLARED)].map((match) => match[1] ?? ''))].filter((name) => name !== '')

  const values = imported.map((entry) => {
    const value = library[entry.exported]
    if (value === undefined) throw new Error(`${LIBRARY} exports no "${entry.exported}"`)
    return value
  })

  const factory = new Function(
    ...imported.map((entry) => entry.local),
    `"use strict";\n${body}\n;return { ${declared.join(', ')} };`,
  ) as (...args: unknown[]) => Record<string, unknown>

  const module = factory(...values)

  const value = module.grammar
  if (value === undefined) throw new Error('this file exports no `grammar`')
  const built = typeof value === 'function' ? (value as () => unknown)() : value
  if (built === null || typeof built !== 'object' || !Array.isArray((built as Grammar).rules)) {
    throw new Error('`grammar` is not a grammar: it needs a `rules` list')
  }

  const options = module.options
  return {
    grammar: built as Grammar,
    sample: typeof module.sample === 'string' ? module.sample : undefined,
    options: options !== null && typeof options === 'object' ? (options as ExampleOptions) : {},
  }
}
