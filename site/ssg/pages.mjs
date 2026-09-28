// ─── the page set ───────────────────────────────────────────────────────────
//
// One record per page, grouped the way the site is read: Documentation, API, Examples, Playground.
// `nav` is the group a page belongs to, written out rather than inferred from the url — a group is
// the list the sidebar shows, and `/docs/grammar/` starting with `/docs/` is a coincidence rather
// than the fact that puts it there.
//
// `sources` are concatenated and rendered as one document, which is what lets a page be assembled
// from one of the repository's own reference files next to prose written for the site. `out` is
// relative to the Vite root (`site/pages`) and `url` is where the page lands; they are separate
// fields because a url ends in `/` and a file does not.

/** @typedef {{ url: string, out: string, kind: string, title: string, nav?: string, description: string, sources: string[], specimen?: { id: string, label?: string, controls?: string[] }, headTitle?: string }} PageRecord */

/** @type {readonly PageRecord[]} */
export const PAGES = [
  {
    url: '/',
    out: 'index.html',
    kind: 'home',
    title: 'litearea',
    headTitle: 'litearea — a code editor over a plain textarea',
    description:
      'A code editor over a plain textarea: highlighting from rules you write, completion, diagnostics, and hover. No runtime dependencies, and no grammar shipped.',
    sources: ['content/home.md'],
    specimen: { id: 'swatch', label: 'swatch' },
  },
  {
    url: '/docs/',
    out: 'docs/index.html',
    kind: 'doc',
    title: 'Documentation',
    nav: '/docs/',
    description:
      'Install litearea, mount a first editor, and find the reference: grammar, completion, theming, options, keys, and limits.',
    sources: ['content/docs.md'],
    specimen: { id: 'swatch-overview', label: 'swatch' },
  },
  {
    url: '/docs/grammar/',
    out: 'docs/grammar/index.html',
    kind: 'doc',
    title: 'Grammar',
    nav: '/docs/',
    description:
      'The grammar reference: match, words, and region rules, precedence, vocabularies, diagnostics, decorations, and hover.',
    sources: ['../docs/grammar.md'],
  },
  {
    url: '/docs/completion/',
    out: 'docs/completion/index.html',
    kind: 'doc',
    title: 'Completion',
    nav: '/docs/',
    description:
      'The completion reference: how the list opens, what a source is asked for, how rows are ranked, and what accepting a row does.',
    sources: ['../docs/completion.md'],
  },
  {
    url: '/docs/theming/',
    out: 'docs/theming/index.html',
    kind: 'doc',
    title: 'Theming',
    nav: '/docs/',
    description:
      'Every custom property, the variables option, and what may not change without breaking alignment.',
    sources: ['content/theming.md'],
    specimen: { id: 'swatch-themed', label: 'one grammar, two themes' },
  },
  {
    url: '/docs/options/',
    out: 'docs/options/index.html',
    kind: 'doc',
    title: 'Options and methods',
    nav: '/docs/',
    description: 'Every option litearea takes and every method the editor offers after it mounts.',
    sources: ['content/options.md'],
  },
  {
    url: '/docs/keys/',
    out: 'docs/keys/index.html',
    kind: 'doc',
    title: 'Keys and commands',
    nav: '/docs/',
    description: 'The keymap as data: every command, every default binding, and how to move one.',
    sources: ['content/keys.md'],
  },
  {
    url: '/docs/limits/',
    out: 'docs/limits/index.html',
    kind: 'doc',
    title: 'Limits',
    nav: '/docs/',
    description: 'What litearea does not do, what it cannot do, and where the platform decides.',
    sources: ['content/limits.md'],
  },
  {
    url: '/api/',
    out: 'api/index.html',
    kind: 'doc',
    title: 'API',
    nav: '/api/',
    description: 'Every export of @citisen/litearea, by entry point.',
    sources: ['content/api.md'],
  },
  {
    url: '/api/react/',
    out: 'api/react/index.html',
    kind: 'doc',
    title: 'React',
    nav: '/api/',
    description: 'The React binding: the props of LiteAreaEditor and what the text never passes through.',
    sources: ['content/react.md'],
  },
  {
    url: '/api/architecture/',
    out: 'api/architecture/index.html',
    kind: 'doc',
    title: 'Architecture',
    nav: '/api/',
    description:
      'Why litearea is built this way: the one-parse rule, the uncontrolled textarea, layer alignment, and what was rejected.',
    sources: ['../docs/architecture.md'],
  },
  {
    url: '/examples/',
    out: 'examples/index.html',
    kind: 'doc',
    title: 'Examples',
    nav: '/examples/',
    description: 'Six complete languages, each one running live on its own page.',
    sources: ['content/examples.md'],
  },
  {
    url: '/examples/swatch/',
    out: 'examples/swatch/index.html',
    kind: 'example',
    title: 'Swatch',
    nav: '/examples/',
    description: 'A palette whose word set comes from the host rather than from the file.',
    sources: ['content/example-swatch.md'],
    specimen: { id: 'swatch', label: 'swatch', controls: ['reset'] },
  },
  {
    url: '/examples/form-schema/',
    out: 'examples/form-schema/index.html',
    kind: 'example',
    title: 'Form schema',
    nav: '/examples/',
    description: 'Typed rows, a note region, a declarative check, and an analysis completion reads.',
    sources: ['content/example-form-schema.md'],
    specimen: { id: 'form-schema', label: 'form schema', controls: ['reset'] },
  },
  {
    url: '/examples/mini-conf/',
    out: 'examples/mini-conf/index.html',
    kind: 'example',
    title: 'Mini conf',
    nav: '/examples/',
    description: 'A key/value configuration language with a nesting region and per-key completion.',
    sources: ['content/example-mini-conf.md'],
    specimen: { id: 'mini-conf', label: 'mini conf', controls: ['reset'] },
  },
  {
    url: '/examples/sticky/',
    out: 'examples/sticky/index.html',
    kind: 'example',
    title: 'Sticky headers',
    nav: '/examples/',
    description: 'Blocks that nest, with the header the reader is inside pinned to the top of the box.',
    sources: ['content/example-sticky.md'],
    specimen: { id: 'sticky', label: 'plan' },
  },
  {
    url: '/examples/typing-aids/',
    out: 'examples/typing-aids/index.html',
    kind: 'example',
    title: 'Typing aids',
    nav: '/examples/',
    description: 'Pairs that close themselves, a selection that wraps, and a comment toggle.',
    sources: ['content/example-typing-aids.md'],
    specimen: { id: 'typing-aids', label: 'data' },
  },
  {
    url: '/examples/completion/',
    out: 'examples/completion/index.html',
    kind: 'example',
    title: 'Completion',
    nav: '/examples/',
    description: 'Tiered ranking, a documentation panel, commit characters, and an inline preview.',
    sources: ['content/example-completion.md'],
    specimen: { id: 'completion', label: 'font stack', controls: ['inline', 'reset'] },
  },
  {
    url: '/playground/',
    out: 'playground/index.html',
    kind: 'playground',
    title: 'Playground',
    nav: '/playground/',
    description:
      'Write a grammar and a document in two live editors, and watch what the engine reports for every keystroke.',
    sources: ['content/playground.md'],
  },
  {
    url: '/404.html',
    out: '404.html',
    kind: 'doc',
    title: 'Not here',
    description: 'That page is not on this site.',
    sources: ['content/404.md'],
  },
]
