/**
 * Output Truncation
 *
 * Handles large command/search outputs by keeping head and tail,
 * with a truncation notice in between.
 *
 * Based on pi's truncate.ts (opensource/pi/packages/coding-agent/src/core/tools/truncate.ts)
 */

export interface TruncatedResult {
  content: string
  truncated: boolean
}

/**
 * Truncate output to a maximum number of lines.
 * Keeps the first half and last half, with a notice in between.
 */
export function truncateLines(
  output: string,
  maxLines: number = 500,
): TruncatedResult {
  const lines = output.split('\n')

  if (lines.length <= maxLines) {
    return { content: output, truncated: false }
  }

  const half = Math.floor(maxLines / 2)
  const head = lines.slice(0, half)
  const tail = lines.slice(-half)
  const omitted = lines.length - maxLines

  return {
    content: [
      ...head,
      `... (${omitted} lines truncated) ...`,
      ...tail,
    ].join('\n'),
    truncated: true,
  }
}

/**
 * Truncate output to a maximum number of bytes.
 */
export function truncateBytes(
  output: string,
  maxBytes: number = 100_000,
): TruncatedResult {
  const byteLength = Buffer.byteLength(output, 'utf-8')

  if (byteLength <= maxBytes) {
    return { content: output, truncated: false }
  }

  // Truncate by bytes, then align to line boundary
  const truncated = Buffer.from(output, 'utf-8').subarray(0, maxBytes).toString('utf-8')
  const lastNewline = truncated.lastIndexOf('\n')
  const content = lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated

  return {
    content: content + `\n... (output truncated at ${maxBytes} bytes)`,
    truncated: true,
  }
}

/**
 * Apply both line and byte truncation.
 */
export function truncateOutput(
  output: string,
  maxLines: number = 500,
  maxBytes: number = 100_000,
): TruncatedResult {
  const byteResult = truncateBytes(output, maxBytes)
  const lineResult = truncateLines(byteResult.content, maxLines)

  return {
    content: lineResult.content,
    truncated: byteResult.truncated || lineResult.truncated,
  }
}
