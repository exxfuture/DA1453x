import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

/**
 * ESLint flat config (review FE-08).
 *
 * Until this existed, `npm run lint` was `tsc -b --noEmit` under another name and
 * the three `eslint-disable-next-line react-hooks/exhaustive-deps` comments in
 * the app referred to a rule that had never been installed, let alone evaluated.
 * `npm run lint` now runs the typechecker AND this; the disables it turned out to
 * be hiding were fixed rather than kept (see hooks/useSelectedDevice.ts).
 *
 * Three plugin sets, each earning its place:
 *  - typescript-eslint (type-aware): catches the things `tsc` permits but that
 *    are almost always mistakes here — a floating promise from a fire-and-forget
 *    publish, an `await` on a non-promise, an unnecessary condition on a value
 *    the types say is always truthy.
 *  - react-hooks: dependency-array correctness, the actual reason the disables
 *    above were suspicious.
 *  - jsx-a11y: this is a health app with a screen-reader story (see the review's
 *    FE-18); label/alt/role mistakes should fail a check, not a code review.
 */
export default tseslint.config(
  {
    // Build output, dependencies and test artifacts are not source.
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'test-results/**', 'playwright-report/**', 'public/env.js'],
  },

  // ---- application + e2e sources (type-aware) -------------------------------
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        // Type-aware linting needs the same program the build uses. The e2e
        // suite is covered by tsconfig.node.json's sibling include below.
        project: ['./tsconfig.app.json', './tsconfig.node.json', './tsconfig.e2e.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,

      // The two classic hook rules, as errors. `exhaustive-deps` is the one this
      // codebase was suppressing without ever running (review FE-08).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',

      // NOTE: eslint-plugin-react-hooks v7's `recommended` preset is deliberately
      // NOT extended, because it also switches on the React Compiler preview
      // rules (purity, set-state-in-effect, immutability, refs, …). On this
      // codebase those fire on event handlers that read the clock (`purity`
      // inside an onClick) and on the ordinary "seed form state once the query
      // resolves" effect — i.e. mostly on code that is correct today. Adopting
      // them is a real refactor of every form plus theme/chartColors.ts, worth
      // doing deliberately rather than as a side effect of installing a linter.

      // `<ul role="list">` is not redundant in practice: Safari/VoiceOver drops
      // a list's semantics when `list-style: none` is applied, which every list
      // in this design system does (see components/ui/DeviceList.tsx).
      'jsx-a11y/no-redundant-roles': ['error', { ul: ['list'] }],

      // A few labels wrap their control inside a layout <span> for the
      // two-line "name + device" rows (PatientsPage's compare list), which is
      // three levels down rather than the default two.
      'jsx-a11y/label-has-associated-control': ['error', { depth: 4 }],

      // An unused binding is either dead code or a typo. `_`-prefixed args stay
      // legal: an interface method that must accept a callback it ignores (see
      // SimulatedBluetoothTransport#onDisconnected) documents itself that way.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

      // Fire-and-forget is a real pattern here (a best-effort MQTT publish, a
      // signinRedirect from an onClick), but it has to be spelled `void x()` so
      // the intent is visible and a genuinely dropped rejection stands out.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],

      // The API surface is `unknown`-typed at the boundary and cast once, on
      // purpose; `any` anywhere else is an escape hatch this codebase does not use.
      '@typescript-eslint/no-explicit-any': 'error',

      // Template literals interpolating a value of unknown shape hide bugs in
      // user-visible strings; `String(x)` at the call site is explicit.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: false, allowNullish: false },
      ],
    },
  },

  // ---- vitest/Playwright specs ---------------------------------------------
  {
    files: ['**/*.test.{ts,tsx}', 'e2e/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Tests deliberately pass deficient objects to assert the handling of
      // them, and Playwright's fixtures are full of intentional non-null
      // assertions.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // ---- ESM config files that run in Node (vite/tailwind/postcss/eslint) ----
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended, tseslint.configs.disableTypeChecked],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
);
