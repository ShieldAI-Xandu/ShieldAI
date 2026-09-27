import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    // Frontend: src/** runs in the browser.
    files: ['src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // Backend: everything else (server.js, *Routes.js, cli/, tests/, scripts/)
    // runs under Node, not a browser — without this block every `process`,
    // `Buffer`, `__dirname`, etc. reference in these files was a false-positive
    // no-undef error, drowning out real findings under `npm run lint`.
    files: ['**/*.{js,mjs}'],
    ignores: ['src/**', 'dist/**', 'modalFocus.test.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
  {
    // modalFocus.test.mjs is the repo's only DOM test (see its own header
    // comment) — it runs under Node but mounts the real Modal.jsx via jsdom,
    // so it legitimately needs both Node and browser globals.
    files: ['modalFocus.test.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
])
