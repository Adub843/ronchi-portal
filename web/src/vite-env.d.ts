/// <reference types="vite/client" />

// occt-import-js ships without types. See web/src/catalog/step.ts.
declare module "occt-import-js" {
  const occtimportjs: (opts?: { locateFile?: (name: string) => string }) => Promise<{
    ReadStepFile: (data: Uint8Array, params: Record<string, unknown> | null) => unknown;
  }>;
  export default occtimportjs;
}
