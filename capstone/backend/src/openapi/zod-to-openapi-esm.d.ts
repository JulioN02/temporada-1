/**
 * Ambient types for the ESM build of @asteasolutions/zod-to-openapi (T-6-4).
 *
 * WHY: the package has no `exports` field (main: dist/index.cjs). Under
 * NodeNext ESM, `import ... from '@asteasolutions/zod-to-openapi'` resolves to
 * the CJS build, which extends the CJS zod class — but this project's schemas
 * are ESM-zod instances (zod v4 dual build), so `.openapi()` never lands on
 * them. The bundled dist/index.mjs is the same code with zero imports; it
 * extends WHATEVER zod instance is passed to extendZodWithOpenApi, so the ESM
 * build + ESM zod work together (verified by the R-DOC-1 suite).
 */
declare module '@asteasolutions/zod-to-openapi/dist/index.mjs' {
  export * from '@asteasolutions/zod-to-openapi'
}