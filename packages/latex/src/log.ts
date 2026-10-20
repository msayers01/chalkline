import type { SourceMapEntry } from './render/render.js';

/**
 * Reads a LuaLaTeX log: errors (with `-file-line-error`) and overfull boxes,
 * mapped back to the innermost block through the source map so review can
 * flag the right block and the overflow fixer can act on it.
 */

export type LogFinding =
  | { kind: 'error'; line?: number; message: string }
  | { kind: 'overfull'; line: number; points: number };

export type BlockFinding = LogFinding & { blockId?: string };

const ERROR = /^(?:\.\/)?[^:\s]+\.tex:(\d+): (.*)$/;
const OVERFULL =
  /^Overfull \\hbox \((\d+(?:\.\d+)?)pt too wide\) (?:in paragraph at lines (\d+)--\d+|detected at line (\d+)|in alignment at lines (\d+)--\d+)/;

export function parseLatexLog(log: string): LogFinding[] {
  const findings: LogFinding[] = [];
  for (const raw of log.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const error = ERROR.exec(line);
    if (error) {
      findings.push({ kind: 'error', line: Number(error[1]), message: error[2] ?? '' });
      continue;
    }
    if (line.startsWith('! ')) {
      findings.push({ kind: 'error', message: line.slice(2) });
      continue;
    }
    const overfull = OVERFULL.exec(line);
    if (overfull) {
      const at = overfull[2] ?? overfull[3] ?? overfull[4];
      findings.push({ kind: 'overfull', points: Number(overfull[1]), line: Number(at) });
    }
  }
  return findings;
}

/** The innermost block whose line range contains `line`. */
export function blockAtLine(
  sourceMap: readonly SourceMapEntry[],
  line: number,
): string | undefined {
  let best: SourceMapEntry | undefined;
  for (const entry of sourceMap) {
    if (line < entry.startLine || line > entry.endLine) continue;
    if (!best || entry.endLine - entry.startLine < best.endLine - best.startLine) best = entry;
  }
  return best?.blockId;
}

export function mapFindingsToBlocks(
  findings: readonly LogFinding[],
  sourceMap: readonly SourceMapEntry[],
): BlockFinding[] {
  return findings.map((f) => {
    const blockId = f.line !== undefined ? blockAtLine(sourceMap, f.line) : undefined;
    return blockId ? { ...f, blockId } : f;
  });
}
