/**
 * Pure helpers shared by the record builder and the collectors. The
 * builder itself — ctx + store → canonical record → logger emit, invoked
 * from the on-finished callback after the response is flushed — lands
 * with the core port (issue #4)
 */

export function hrtimeToMs(duration: [number, number]): number {
  return duration[0] * 1000 + duration[1] / 1e6
}

export function shouldSkip(path: string, patterns: (string | RegExp)[]): boolean {
  return patterns.some((pattern) => {
    if (typeof pattern === 'string') {
      return path === pattern || path.startsWith(pattern.endsWith('/') ? pattern : `${pattern}/`)
    }
    return pattern.test(path)
  })
}
