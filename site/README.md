# The documentation site

The site at `https://citisen.github.io/litearea/`, and it is served from this
directory. Nothing here is part of the published package: `files` in
`package.json` lists `dist`, `docs`, `src`, `scripts`, and the READMEs, so
`site/` is exactly what a maintainer runs and a consumer never downloads.

```sh
npm run site          # development: http://localhost:5178
npm run site:build    # render and bundle into site/dist
npm run site:preview  # serve the built site
npm run site:check    # load every page in headless Chrome and report
```

`npm run site` starts two processes, and both are necessary. `site/build.mjs`
renders the markdown into HTML; Vite serves that HTML with the one stylesheet
and the one script it links. The generator watches `site/content/`, `site/ssg/`,
and the repository's own `docs/`, so editing a reference page rewrites the HTML
and Vite reloads. The stylesheet and the client modules are Vite's own hot path
and do not go through the generator at all.

## Why there is no framework

The site is a hand-written static generator and one stylesheet, and that is a
decision about how it should look rather than about how it should build. A
documentation framework arrives with an opinion — a hero, a grid of feature
cards, a theme with a gradient in it — and the fastest way to publish a site that
looks like every other project's is to accept it. The layout here is a warm paper
ground, hairline rules, one vermilion accent, and a live editor pinned beside the
prose.

What that costs is a renderer, and the renderer is `site/ssg/markdown.mjs`: about
four hundred lines covering exactly the markdown this repository writes — ATX
headings, paragraphs, lists, tables, fences, quotes, inline code, bold, italic,
links — plus four directives, described below. It is not a Markdown
implementation and does not try to be.

## The shape of it

The pages are grouped the way they are read: Documentation, API, Playground. One
group is one sidebar, so a page's own group and the page's own sections are a
single list in a single column, and the masthead is three links and nothing else.
`nav` on a page record is the group; `PAGES` in `ssg/pages.mjs` is the whole set,
in the order the site is read.

The playground is one page and one instrument rather than a group of example
pages. Its list of languages is a `<select>` at the top of the instrument, its
left pane is the whole source file of the language it is showing, and its right
pane is a document read with whatever that file currently says. Nothing there is
prose about the examples, because the examples explain themselves in their own
comments — see "Adding an example" below.

| Path | What it is |
| --- | --- |
| `ssg/markdown.mjs` | Markdown and the directives, in and HTML out |
| `ssg/highlight.mjs` | A small tokenizer, for the static code samples |
| `ssg/layout.mjs` | The shell: masthead, sidebar, article, specimen, foot |
| `ssg/frames.mjs` | The one frame a live editor is shown in |
| `ssg/pages.mjs` | The page set: url, output path, title, group, sources, specimen, `wide` |
| `content/*.md` | The prose, one file per page |
| `pages/assets/` | The hand-written half: stylesheet, client modules, favicon |
| `pages/assets/examples/*.js` | The six languages, one file each: the source the playground edits and the page runs |
| `pages/assets/examples/run.ts` | Turning one of those files into a language: the imports it asks for are injected, its `export`s are collected |
| `pages/assets/playground.ts` | The instrument: the list, the two panes, and the evaluation of an edit |
| `pages/assets/search.ts` | The search box, over the index the build writes |
| `pages/public/fonts/` | The two woff2 files, copied to the site root as they stand |
| `pages/public/*.md`, `llms*.txt`, `search.json` | GENERATED machine-readable output, gitignored |
| `pages/**/*.html` | GENERATED, gitignored, and the Vite root |
| `dist/` | The built site, gitignored |

`site/pages/` is both the Vite root and the output directory of the generator,
which is why a page's output path is also its URL: `docs/grammar/index.html` is
served at `/docs/grammar/`. Every link inside the site is relative, computed from
how deep the page sits, so the same output works from `/` in development and from
`/litearea/` on Pages with nothing rewritten.

## Adding a page

Add a fragment to `content/`, add a record to `PAGES` in `ssg/pages.mjs` with the
`nav` of the group it belongs to, and run the build. The record's `sources` are
resolved against `site/`, so `../docs/grammar.md` is the repository's own
reference and `content/api.md` is a file written for the site.

## The directives

Four block directives, on top of plain markdown. They exist because a
documentation page is not only prose: it has editors in it, and it quotes files
that must not drift from the code.

| Directive | What it does |
| --- | --- |
| `::: live <id>` | Mounts the example registered under `<id>`, in the flow of the article |
| `::: code <path>` | Includes a file, whole or by `lines=12-40`, with the file's own line numbers |
| `::: raw` | HTML written by hand, for the one thing markdown cannot say |
| `::: bench` | The playground, built by `pages/assets/playground.ts` |

`live` and `bench` are dropped from the text copies rather than described.

There used to be a fifth, `::: try`, which printed a list of things to do beside
the editor it was about. It is gone: a list like that is prose about code that a
reader has to look away from the code to read, and the tips live in the example's
own source file now, as comments, which is where a reader who is about to try
something is already looking. Both `ssg/markdown.mjs` and the mirror writer refuse
one rather than quietly dropping it.

A page whose body is an instrument rather than an article sets `wide: true`: the
reading measure comes off its prose and its samples, and the playground takes the
height the window has left once the client has measured the prose above it. That
is what puts the whole source file and the document it reads on one screen — see
`watchLead` in `pages/assets/playground.ts`.

## Adding an example

Two steps, and the first one is the language:

1. Write `pages/assets/examples/<id>.js`. It is a plain JavaScript module —
   deliberately not TypeScript, because the page evaluates its TEXT in the browser
   and `tsc` syntax is not something `new Function` can read — that ends with three
   exports:

   | Export | What it is |
   | --- | --- |
   | `grammar` | The language, or a function that builds one where a host's data decides it |
   | `sample` | A document written in it, which the preview starts from |
   | `options` | What the editor needs beyond the grammar: `completion`, `sticky`, `indent`, `keys` |

   Its imports are the interesting part. `run.ts` takes every `import { … } from
   '@citisen/litearea'` off the text and hands those names to the function as
   parameters, so a source reaches the library and nothing else on the page — and
   any other specifier is refused with a message saying so. That is also why there
   are no type-only imports and no generics in these files: what is shown in the
   editor has to be what the browser can run.

   The header comment is where an example's notes go, including the handful of
   "things to try" that used to be a `::: try` block: `action → what happens`, one
   per line.

   A line is at most 96 columns, and the test above fails on the 97th. That is the
   pane's own width, measured: at a 1512px window the left pane of the playground
   fits a hundred characters and about ninety-eight of them once its scrollbar is
   showing. So a long object is written one property to a line rather than run on,
   which is also the only way a reader can see its shape.

2. Add it to `EXAMPLES` in `pages/assets/examples/index.ts`. The order of that list
   is the order of the `<select>`; the file is imported with Vite's `?raw`, so the
   text the page shows is byte for byte the file that runs.

`test/site-examples.test.ts` is what checks these files, since `tsc` does not read
a `.js`. It evaluates each one, reads that example's own document with the language
that came out, and asks that something was painted — plus two named cases for the
languages whose point is a thing their document has to reach. It is worth knowing
why: an example whose document never reaches the rules it exists to demonstrate
still evaluates, still paints plain text, and still looks finished on the page.

## Publishing

`.github/workflows/pages.yml`, and the trigger is manual. Nothing redeploys on a
push: the published site should be something a maintainer decided to publish, not
whatever the last commit happened to build. Run it from Actions when the site is
ready, and set the repository's Pages source to "GitHub Actions" once.

The build sets `base` to `/litearea/`, which is where a project page lives. A
custom domain changes that one string in `vite.config.ts` and nothing else.

## For machines

The readers of a library's documentation are increasingly agents, and an agent should not have to
parse a layout to find a signature. So every page is also written out as markdown, and two files
tie them together:

| File | What it is |
| --- | --- |
| `llms.txt` | The index: every page and its markdown url, one line each |
| `llms-full.txt` | Every page concatenated, for something that would rather make one request |
| `/docs/grammar.md`, `/docs/options.md`, … | The page as text, at a url derived from the page's own |

The mirrors are generated from the same sources as the HTML by the same build, with the directives
resolved: `::: code` is inlined from the file it names, and the two that mount an editor are dropped
because they have no text form. Links inside them are absolute — a file fetched on its own has no
base to resolve a relative link against — and each HTML page carries
`<link rel="alternate" type="text/markdown">` pointing at its own mirror.

## Checking it

`npm run site:check` has two passes, and neither needs the other.

The first reads the generated HTML and follows every link and anchor in it. A broken anchor is
invisible otherwise: the page renders, the link works, and the reader arrives at the top of the
right page wondering what they were meant to see.

The second loads every page in headless Chrome, at two widths, and reads three things back: how
many of the page's live editors mounted, whether anything is cut off, and whether the browser
logged an error. "Cut off" means an element wider than the window that is *not* inside something
that scrolls, because a code sample and a wide table are both deliberately wider and both scroll
inside their own box — while a table two pixels too wide is silently clipped by the page's own
`overflow-x: hidden`, and that is the failure worth failing on.

It is not a test suite — nothing in it asserts what an example says — but the failures it does
catch are the silent ones, and a live editor that never mounted leaves a page that still looks
finished. Run it against `npm run site:preview` to check the built site under its deployment base:
`SITE_URL=http://localhost:5179/litearea npm run site:check`.
