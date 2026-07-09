import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Absolute path to the stubs directory, resolved from the build output
 */
export const stubsRoot = dirname(fileURLToPath(import.meta.url))
