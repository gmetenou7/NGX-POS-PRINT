import { Injectable } from '@angular/core';
import type { PaperSize, PrintLine, PrintResult } from '../models/print.models';

/**
 * Fallback print driver using `window.print()` via a hidden iframe.
 * Works on all browsers that support printing. Uses CSS @media print
 * for thermal paper formatting (58mm or 80mm).
 */
@Injectable({ providedIn: 'root' })
export class WindowPrintService {
  /**
   * Checks if window.print() is available.
   */
  isAvailable(): boolean {
    return typeof window !== 'undefined' && typeof window.print === 'function';
  }

  /**
   * Renders PrintLines as HTML inside a hidden iframe and triggers window.print().
   * @param lines - Array of print lines to render
   * @param paperSize - Paper width in mm (58 or 80)
   * @returns Print result indicating success or failure
   */
  async print(lines: PrintLine[], paperSize: PaperSize = 80): Promise<PrintResult> {
    try {
      const html = this.buildHtml(lines, paperSize);
      await this.printViaIframe(html);
      return { success: true, driver: 'window', timestamp: Date.now() };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown window.print error';
      return { success: false, driver: 'window', error: message, timestamp: Date.now() };
    }
  }

  /** Builds a complete HTML document styled for thermal paper printing. */
  private buildHtml(lines: PrintLine[], paperSize: PaperSize): string {
    const widthMm = paperSize;
    const bodyLines = lines.map((line) => this.renderLine(line)).join('\n');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page {
    size: ${widthMm}mm auto;
    margin: 0;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 12px;
    line-height: 1.2;
    width: ${widthMm}mm;
    padding: 2mm;
  }
  .line { width: 100%; }
  .text-left { text-align: left; }
  .text-center { text-align: center; }
  .text-right { text-align: right; }
  .bold { font-weight: bold; }
  .underline { text-decoration: underline; }
  .double-height { font-size: 24px; line-height: 1.2; }
  .double-width { letter-spacing: 0.5em; }
  .separator { border-top: 1px dashed #000; margin: 4px 0; }
  @media print {
    body { width: ${widthMm}mm; }
  }
</style>
</head>
<body>
${bodyLines}
</body>
</html>`;
  }

  /** Converts a single PrintLine to an HTML string. */
  private renderLine(line: PrintLine): string {
    switch (line.type) {
      case 'text': {
        const classes: string[] = ['line'];
        if (line.align) classes.push(`text-${line.align}`);
        if (line.bold) classes.push('bold');
        if (line.underline) classes.push('underline');
        if (line.doubleHeight) classes.push('double-height');
        if (line.doubleWidth) classes.push('double-width');
        const escaped = this.escapeHtml(line.content ?? '');
        return `<div class="${classes.join(' ')}">${escaped}</div>`;
      }
      case 'separator':
        return '<div class="separator"></div>';
      case 'newline':
        return '<br>';
      case 'cut':
        return ''; // Cut has no visual representation in browser print
      case 'raw':
        return ''; // Raw bytes cannot be rendered in browser print
      default:
        return '';
    }
  }

  /** Escapes HTML special characters to prevent XSS. */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /** Creates a hidden iframe, writes HTML to it, and triggers print. */
  private printViaIframe(html: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let printed = false;

      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.left = '-10000px';
      iframe.style.top = '-10000px';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = 'none';

      const cleanup = () => {
        setTimeout(() => {
          if (iframe.parentNode) {
            document.body.removeChild(iframe);
          }
        }, 1000);
      };

      const doPrint = () => {
        if (printed) return;
        printed = true;
        const win = iframe.contentWindow;
        if (!win) {
          cleanup();
          reject(new Error('Could not access iframe window.'));
          return;
        }
        try {
          win.focus();
          win.print();
          resolve();
        } catch (err) {
          reject(err);
        } finally {
          cleanup();
        }
      };

      document.body.appendChild(iframe);

      const iframeWindow = iframe.contentWindow;
      if (!iframeWindow) {
        document.body.removeChild(iframe);
        reject(new Error('Could not access iframe window.'));
        return;
      }

      const iframeDoc = iframeWindow.document;
      iframeDoc.open();
      iframeDoc.write(html);
      iframeDoc.close();

      iframe.onload = doPrint;

      // Fallback if onload doesn't fire (some browsers)
      setTimeout(doPrint, 500);
    });
  }
}
