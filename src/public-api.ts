/*
 * Public API Surface of ngx-pos-print
 */

// Models
export type {
  PrintDriver,
  TextAlign,
  PaperSize,
  PosPrintConfig,
  PrintLine,
  PrintJob,
  PrintResult,
  DetectedPrinter,
  PrintDriverAdapter,
} from './lib/models/print.models';

// Providers
export { POS_PRINT_CONFIG, POS_PRINT_CUSTOM_DRIVERS, providePosPrint } from './lib/providers/pos-print.providers';

// Builder
export { EscPosBuilder } from './lib/builders/escpos-builder';

// Services
export { PosPrintService } from './lib/services/pos-print.service';
export { BluetoothPrintService } from './lib/services/bluetooth-print.service';
export { NetworkPrintService } from './lib/services/network-print.service';
export { UsbPrintService } from './lib/services/usb-print.service';
export { WindowPrintService } from './lib/services/window-print.service';

// Module
export { NgxPosPrintModule } from './lib/ngx-pos-print.module';
