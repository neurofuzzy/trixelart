import { createRequire } from "module";

const require = createRequire(import.meta.url);

const eslintConfig = [
  ...require("eslint-config-next"),
  ...require("eslint-config-next/core-web-vitals"),
  ...require("eslint-config-next/typescript"),
  {
    // These React-Compiler rules flag the intentional "mirror a prop/state
    // into a ref during render" pattern this codebase uses pervasively for
    // stable event-handler closures (e.g. `ctxRef.current = ctx`). Keep them
    // visible as warnings rather than failing lint / CI.
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];

export default eslintConfig;
