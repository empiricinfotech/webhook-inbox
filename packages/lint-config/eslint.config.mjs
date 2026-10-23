import js from "@eslint/js";
import tseslint from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  {
    ignores: [
      "**/node_modules/**", "**/.next/**", "**/dist/**", "**/build/**",
      "**/next-env.d.ts", "**/coverage/**", "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({
    ...config, files: ["**/*.{ts,tsx}"],
  })),
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/web/**/*.{js,jsx,mjs,ts,tsx}"],
    plugins: {
      "react-hooks": hooks,
    },
    languageOptions: { globals: globals.browser },
    rules: {
      ...hooks.configs.recommended.rules,
    },
  },
];
