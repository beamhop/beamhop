/**
 * Strict newline-delimited JSON framing for pi-mono RPC stdio.
 *
 * Per pi-mono docs: split on \n only, strip trailing \r, never use
 * Node/Bun readline (it splits on Unicode line separators too and would
 * corrupt JSON payloads containing U+2028 / U+2029).
 */
export class LineSplitter {
  private buf = "";

  /** Feed a chunk; returns zero or more complete lines (no trailing \n). */
  push(chunk: string | Uint8Array): string[] {
    const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    this.buf += text;
    const out: string[] = [];
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) !== -1) {
      let line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      out.push(line);
    }
    return out;
  }

  /** Any unterminated tail (no trailing newline yet). */
  remainder(): string {
    return this.buf;
  }
}
