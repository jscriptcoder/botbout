import js from "@eslint/js";
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";
import prettier from "eslint-config-prettier";

// Flat config. ESLint owns code *logic* + blank-line spacing; Prettier owns
// width/quotes/commas. `prettier` is applied before our rules block so it
// switches off formatting rules that would fight Prettier — then we re-enable
// exactly the blank-line rules Prettier does not manage.
export default tseslint.config(
  {
    ignores: [
      "dist/",
      "coverage/",
      "reports/",
      ".stryker-tmp/",
      "node_modules/",
      // Vendored Claude Code tooling — not project source (matches .prettierignore).
      ".claude/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    plugins: { "@stylistic": stylistic },
    rules: {
      // Breathing room between blocks of code — the spacing Prettier won't add.
      "@stylistic/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "*", next: "return" },
        { blankLine: "always", prev: "import", next: "*" },
        { blankLine: "any", prev: "import", next: "import" },
        {
          blankLine: "always",
          prev: "*",
          next: [
            "multiline-block-like",
            "multiline-const",
            "multiline-let",
            "function",
          ],
        },
        {
          blankLine: "always",
          prev: [
            "multiline-block-like",
            "multiline-const",
            "multiline-let",
            "function",
          ],
          next: "*",
        },
      ],
      "@stylistic/lines-between-class-members": [
        "error",
        "always",
        { exceptAfterSingleLine: true },
      ],
      // Honour the codebase's "intentionally unused" convention: the `_`-prefix
      // and the destructuring omit idiom (`const { x: _omit, ...rest } = o`).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
);
