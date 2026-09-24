import { z } from 'zod'
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi/dist/index.mjs'

/**
 * OpenAPI zod extension bootstrap (T-6-4).
 *
 * MUST be imported BEFORE any DTO module in the process (see the first import
 * of app.ts and openapi/registry.ts). WHY: zod v4's `$constructor` copies
 * prototype methods onto each schema instance at CREATION time — patching
 * `ZodType.prototype` afterwards does not reach schemas created earlier. So
 * `extendZodWithOpenApi(z)` has to run before modules/auth/dto.ts (and the
 * other DTO modules) create their schemas, or `.openapi()` is missing on
 * them and the registry cannot derive refs (R-DOC-1).
 *
 * The ESM build of zod-to-openapi is imported deliberately: the package has
 * no `exports` field, so a bare specifier resolves to the CJS build, which
 * patches the CJS zod copy while this project uses the ESM zod build
 * (zod v4 ships dual builds). See zod-to-openapi-esm.d.ts.
 */
extendZodWithOpenApi(z)

export { z }