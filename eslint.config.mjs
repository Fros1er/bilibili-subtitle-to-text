import globals from "globals";
import pluginJs from "@eslint/js";


export default [
  { files: ["**/*.js"], languageOptions: { sourceType: "script" } },
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.jquery,
        ...globals.greasemonkey
      }
    }
  },
  {
    rules: {
      indent: [
        "error",
        2
      ],
      "linebreak-style": [
        "error",
        "unix"
      ],
      quotes: [
        "error",
        "double"
      ],
      semi: [
        "error",
        "never"
      ]
    }
  },
  pluginJs.configs.recommended,
];