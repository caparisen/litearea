// @vitest-environment happy-dom
//
// The composite document, from the keyboard's side.
//
// The engine test (`test/embed.test.ts`) proves that the right language paints the right
// text and that completion and hover are answered by it. This file proves the other half:
// that the decisions the EDITOR makes from a keystroke — which pair closes itself, which
// comment marker `Ctrl+/` writes, whether a character is a word character that opens the
// list — are made by the language the caret is in rather than by the outer one. That is the
// difference between an embedded language and a cleverer highlighter, and it is exactly the
// kind of difference a unit test of the scanner cannot see.

import { afterEach, describe, expect, it } from 'vitest'
import { createEditor } from '../../src/dom/create.js'
import type { LiteArea, LiteAreaOptions } from '../../src/dom/editor.js'
import type { Grammar } from '../../src/core/types.js'
import { compositeGrammar } from '../../examples/demo/grammars/composite.js'

/** Every editor this file mounted, so nothing leaks into the next test. */
let mounted: LiteArea[] = []

/** Mount an editor over the composite grammar. */
function open(value: string, options: Partial<LiteAreaOptions> = {}): LiteArea {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const editor = createEditor(host, { grammar: compositeGrammar(), value, ...options })
  mounted.push(editor)
  editor.focus()
  return editor
}

afterEach(() => {
  for (const editor of mounted) editor.destroy()
  mounted = []
  document.body.replaceChildren()
})

/**
 * Type text the way the browser reports it: the value changes, then `input` fires.
 *
 * This is the path a character takes when `beforeinput` did NOT intercept it — which is the
 * point of the tests that use it: they assert what the editor does when it declines a
 * keystroke, and that it is asked the right question in the first place.
 */
function type(editor: LiteArea, text: string, at: number = editor.input.value.length): void {
  const next = editor.input.value.slice(0, at) + text + editor.input.value.slice(at)
  editor.input.value = next
  editor.input.setSelectionRange(at + text.length, at + text.length)
  editor.input.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }),
  )
}

/**
 * Press a key, and report whether the editor TOOK it.
 * @returns true when a listener called `preventDefault`.
 */
function press(editor: LiteArea, key: string, extra: KeyboardEventInit = {}): boolean {
  return !editor.input.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }),
  )
}

/**
 * Type one character through `beforeinput`, the way the platform reports a keystroke that is
 * about to insert text.
 * @returns true when the editor took the character, false when it left it to the browser.
 */
function insert(editor: LiteArea, character: string, at: number): boolean {
  editor.input.setSelectionRange(at, at)
  return !editor.input.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: character,
    }),
  )
}

/** The rows of the open completion list. */
function rows(editor: LiteArea): string[] {
  return [...editor.element.querySelectorAll<HTMLElement>('.litearea-row')].map(
    (row) => row.textContent ?? '',
  )
}

describe('the comment toggle follows the caret into the embedded language', () => {
  it('writes the embedded marker inside a fence and the outer one outside it', () => {
    const text = 'prose\n```js\nconst a = 1\n```\n'
    const editor = open(text)

    // Inside the fence the language is JavaScript, whose marker is `//`.
    editor.setSelection(text.indexOf('const') + 3)
    expect(press(editor, '/', { ctrlKey: true })).toBe(true)
    expect(editor.value).toBe('prose\n```js\n// const a = 1\n```\n')

    // Outside it the language is Markdown, which has no line marker — so the block form is
    // what is written, and it is a different edit entirely.
    const markdown = open('prose\n')
    markdown.setSelection(0, 5)
    expect(press(markdown, '/', { ctrlKey: true })).toBe(true)
    expect(markdown.value).toContain('prose')
    expect(markdown.value).toContain('<!--')
    expect(markdown.value).toContain('-->')
  })

  it('writes the JSON marker inside a JSON fence', () => {
    const text = '```json\n{"a": 1}\n```\n'
    const editor = open(text)
    editor.setSelection(text.indexOf('"a"'))
    expect(press(editor, '/', { ctrlKey: true })).toBe(true)
    expect(editor.value).toContain('// {"a": 1}')
  })
})

describe('auto-closing pairs follow the caret into the embedded language', () => {
  it('closes a quote inside a JSON fence', () => {
    const text = '```json\n\n```\n'
    const editor = open(text)
    const at = text.indexOf('\n\n') + 1

    expect(insert(editor, '"', at)).toBe(true)
    expect(editor.value).toBe('```json\n""\n```\n')
    expect(editor.selection).toEqual({ start: at + 1, end: at + 1 })
  })

  it('leaves a quote alone outside every fence, where Markdown declares no such pair', () => {
    const editor = open('prose\n')
    expect(insert(editor, '"', 0)).toBe(false)
    expect(editor.value).toBe('prose\n')
  })

  it('closes a Markdown backtick outside a fence and not inside a JSON one', () => {
    // At the end of the line, where the character after the caret is not a word character:
    // the editor deliberately does not close a pair in front of a word, so `(value` is how
    // `(value` gets written.
    const markdown = open('prose ')
    expect(insert(markdown, '`', 6)).toBe(true)
    expect(markdown.value).toBe('prose ``')

    const json = open('```json\n\n```\n')
    const at = '```json\n\n```\n'.indexOf('\n\n') + 1
    // JSON declares `{`, `[`, and `"`: a backtick is not one of them, so the keystroke is the
    // browser's. The outer document's pairs must not reach into the fence.
    expect(insert(json, '`', at)).toBe(false)
    expect(json.value).toBe('```json\n\n```\n')
  })

  it('opens a block between the braces of an embedded language on Enter', () => {
    const text = '```json\n{}\n```\n'
    const editor = open(text, { indent: { unit: 2 } })
    editor.setSelection(text.indexOf('{') + 1)
    // `enterBracket` is answered by the innermost language's pairs, so JSON's braces open a
    // block even though Markdown declares none.
    expect(press(editor, 'Enter')).toBe(true)
    expect(editor.value).toBe('```json\n{\n  \n}\n```\n')
  })
})

describe('a word character is the embedded language`s', () => {
  it('opens the list on a Markdown word character outside a fence', () => {
    const editor = open('')
    type(editor, '-', 0)
    // `-` is a word character of Markdown's names, so it opens the list; the block starter
    // source is eligible at the head of the line, so the list is populated.
    expect(editor.input.getAttribute('aria-expanded')).toBe('true')
    expect(rows(editor).length).toBeGreaterThan(0)
  })

  it('does not open it on the same character inside a JSON fence', () => {
    const text = '```json\n\n```\n'
    const editor = open(text)
    type(editor, '-', text.indexOf('\n\n') + 1)
    // JSON's names have no hyphen in them, so the character is not a reason to suggest
    // anything — and the outer language's word characters are not consulted from in here.
    expect(editor.input.getAttribute('aria-expanded')).toBe('false')
    expect(rows(editor)).toEqual([])
  })

  it('offers the embedded language`s rows inside the fence', () => {
    const text = '```json\n\n```\n'
    const sources: string[] = []
    const editor = open(text, {
      onCompletion: (completion) => {
        if (completion !== undefined) sources.push(completion.sourceId)
      },
    })
    type(editor, 'tr', text.indexOf('\n\n') + 1)

    expect(sources).toContain('json-value')
    expect(rows(editor).some((row) => row.startsWith('true'))).toBe(true)
  })

  it('grows the replaced range with the embedded language`s word characters', () => {
    // The completion's range is what the accepted row replaces, and it is grown with the word
    // predicate of the language at the caret. `-` is a word character to Markdown and not to
    // JSON, so the same typed text replaces a different span in the two places.
    const text = '```json\ntr-ue\n```\n'
    let range: { from: number; to: number } | undefined
    const editor = open(text, {
      onCompletion: (completion) => {
        range = completion?.range
      },
    })
    editor.setSelection(text.indexOf('ue') + 2)
    editor.showCompletions()

    expect(range).toBeDefined()
    // Only `ue` — the hyphen is a separator to JSON, so it is left where it is rather than
    // being swallowed by the replacement.
    expect(text.slice(range?.from ?? 0, range?.to ?? 0)).toBe('ue')
  })
})

describe('an accepted row is handed to the grammar that offered it', () => {
  it('calls the embedded grammar`s onAccept, not the outer one', () => {
    const accepted: Array<{ text: string; label: string }> = []
    const inner: Grammar = {
      id: 'inner',
      rules: [{ kind: 'match', scope: 'inner.word', pattern: /[a-z]+/ }],
      compose: [
        { id: 'inner-rows', range: (context) => context.word, items: () => [{ label: 'beta' }] },
      ],
      // `onAccept` is documented as the place a grammar syncs what it was told. An embedded
      // language's hook is reachable only if the editor resolves WHICH language answered the
      // list, which is what `Completion.grammarId` records.
      onAccept: (result) => accepted.push({ text: result.text, label: result.item.label }),
    }
    const outer: Grammar = {
      id: 'outer',
      rules: [
        { kind: 'region', scope: 'code', begin: /</, end: />/, contentScope: 'code', grammar: inner },
      ],
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = createEditor(host, { grammar: outer, value: '<be>' })
    mounted.push(editor)
    editor.focus()
    editor.setSelection(3)
    editor.showCompletions()

    expect(press(editor, 'Tab')).toBe(true)
    expect(editor.value).toBe('<beta>')
    expect(accepted).toEqual([{ text: '<beta>', label: 'beta' }])
  })
})
