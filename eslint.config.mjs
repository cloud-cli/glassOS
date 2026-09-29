import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  js.configs.recommended,
  {
    files: ["backend/**/*.js", "electron/main.js", "electron/preload.js", "test/**/*.js"],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      curly: ["error", "all"],
    },
  },
  {
    files: ["electron/renderer.js"],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      curly: ["error", "all"],
    },
  },
];
