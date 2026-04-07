import type { TextAlign } from '../models/print.models';

/**
 * ESC/POS command constants.
 * Standard thermal printer command set.
 */
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/**
 * Fluent builder for constructing ESC/POS command byte arrays.
 *
 * @example
 * ```typescript
 * const data = new EscPosBuilder()
 *   .reset()
 *   .align('center')
 *   .bold('MY STORE')
 *   .newLine()
 *   .separator()
 *   .align('left')
 *   .text('Item 1          $10.00')
 *   .newLine()
 *   .separator()
 *   .align('center')
 *   .text('Thank you!')
 *   .feed(3)
 *   .cut()
 *   .build();
 * ```
 */
export class EscPosBuilder {
  private buffers: Uint8Array[] = [];
  private charsPerLine = 48; // default for 80mm paper

  /**
   * Creates a new EscPosBuilder instance.
   * @param paperWidth - Paper width in mm (58 or 80). Determines characters per line.
   */
  constructor(paperWidth: 58 | 80 = 80) {
    this.charsPerLine = paperWidth === 58 ? 32 : 48;
  }

  /**
   * Resets the printer to default settings (ESC @).
   * Should typically be called at the start of a print job.
   */
  reset(): this {
    this.buffers.push(new Uint8Array([ESC, 0x40]));
    return this;
  }

  /**
   * Sets text alignment (ESC a n).
   * @param position - 'left', 'center', or 'right'
   */
  align(position: TextAlign): this {
    const alignMap: Record<TextAlign, number> = { left: 0, center: 1, right: 2 };
    this.buffers.push(new Uint8Array([ESC, 0x61, alignMap[position]]));
    return this;
  }

  /**
   * Enables bold mode, optionally prints text, then disables bold.
   * If no text is provided, just enables bold mode.
   * @param text - Optional text to print in bold
   */
  bold(text?: string): this {
    this.buffers.push(new Uint8Array([ESC, 0x45, 1]));
    if (text !== undefined) {
      this.writeText(text);
      this.buffers.push(new Uint8Array([ESC, 0x45, 0]));
    }
    return this;
  }

  /** Disables bold mode (ESC E 0). */
  boldOff(): this {
    this.buffers.push(new Uint8Array([ESC, 0x45, 0]));
    return this;
  }

  /**
   * Enables underline mode, optionally prints text, then disables underline.
   * If no text is provided, just enables underline mode.
   * @param text - Optional text to print underlined
   */
  underline(text?: string): this {
    this.buffers.push(new Uint8Array([ESC, 0x2d, 1]));
    if (text !== undefined) {
      this.writeText(text);
      this.buffers.push(new Uint8Array([ESC, 0x2d, 0]));
    }
    return this;
  }

  /** Disables underline mode (ESC - 0). */
  underlineOff(): this {
    this.buffers.push(new Uint8Array([ESC, 0x2d, 0]));
    return this;
  }

  /**
   * Enables double-size (height + width) mode, optionally prints text, then resets size.
   * Uses GS ! to set character size.
   * @param text - Optional text to print in double size
   */
  doubleSize(text?: string): this {
    // GS ! n — bit 0-3: width multiplier, bit 4-7: height multiplier
    // 0x11 = width x2, height x2
    this.buffers.push(new Uint8Array([GS, 0x21, 0x11]));
    if (text !== undefined) {
      this.writeText(text);
      this.buffers.push(new Uint8Array([GS, 0x21, 0x00]));
    }
    return this;
  }

  /** Resets character size to normal (GS ! 0). */
  normalSize(): this {
    this.buffers.push(new Uint8Array([GS, 0x21, 0x00]));
    return this;
  }

  /**
   * Prints text content encoded as bytes.
   * Does NOT append a newline — use `.newLine()` after if needed.
   * @param content - Text string to print
   */
  text(content: string): this {
    this.writeText(content);
    return this;
  }

  /**
   * Appends one or more newline characters.
   * @param count - Number of newlines (default 1)
   */
  newLine(count = 1): this {
    const bytes = new Uint8Array(count);
    bytes.fill(LF);
    this.buffers.push(bytes);
    return this;
  }

  /**
   * Prints a separator line (e.g., dashes or equals signs) followed by a newline.
   * @param char - Character to repeat (default '-')
   * @param length - Number of characters (defaults to paper width)
   */
  separator(char = '-', length?: number): this {
    const len = length ?? this.charsPerLine;
    const line = char.repeat(len);
    this.writeText(line);
    this.buffers.push(new Uint8Array([LF]));
    return this;
  }

  /**
   * Sends a paper cut command (GS V).
   * @param partial - If true, performs a partial cut (default false = full cut)
   */
  cut(partial = false): this {
    this.buffers.push(new Uint8Array([GS, 0x56, partial ? 1 : 0]));
    return this;
  }

  /**
   * Feeds paper by the specified number of lines (ESC d n).
   * @param lines - Number of lines to feed (default 3)
   */
  feed(lines = 3): this {
    this.buffers.push(new Uint8Array([ESC, 0x64, Math.min(lines, 255)]));
    return this;
  }

  /**
   * Appends raw bytes directly to the output buffer.
   * Use this for unsupported or custom ESC/POS commands.
   * @param bytes - Raw byte array
   */
  raw(bytes: Uint8Array): this {
    this.buffers.push(bytes);
    return this;
  }

  /**
   * Builds and returns the final ESC/POS byte array.
   * Concatenates all buffered commands into a single Uint8Array.
   */
  build(): Uint8Array {
    let totalLength = 0;
    for (const buf of this.buffers) {
      totalLength += buf.length;
    }
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of this.buffers) {
      result.set(buf, offset);
      offset += buf.length;
    }
    return result;
  }

  /**
   * Returns the configured characters-per-line count.
   * Useful for formatting text externally.
   */
  getCharsPerLine(): number {
    return this.charsPerLine;
  }

  /** Encodes a string to bytes and appends to buffer. */
  private writeText(content: string): void {
    const encoder = new TextEncoder();
    this.buffers.push(encoder.encode(content));
  }
}
