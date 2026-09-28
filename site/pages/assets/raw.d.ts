// ─── `?raw`, for the type checker ───────────────────────────────────────────
//
// Vite hands the TEXT of a file to `import text from './language.js?raw'`, which is how the
// playground shows and edits the file it runs. The bundler resolves that specifier and the type
// checker has no idea what it is, so it is told here.

declare module '*?raw' {
  const text: string
  export default text
}
