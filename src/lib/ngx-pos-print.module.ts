import { NgModule, type ModuleWithProviders } from '@angular/core';
import type { PosPrintConfig, PrintDriverAdapter } from './models/print.models';
import { POS_PRINT_CONFIG, POS_PRINT_CUSTOM_DRIVERS } from './providers/pos-print.providers';

/**
 * Angular module for ngx-pos-print.
 *
 * @example Basic
 * ```typescript
 * @NgModule({ imports: [NgxPosPrintModule.forRoot({ paperSize: 80 })] })
 * export class AppModule {}
 * ```
 *
 * @example With custom Capacitor driver
 * ```typescript
 * @NgModule({
 *   imports: [
 *     NgxPosPrintModule.forRoot(
 *       { paperSize: 80 },
 *       [new CapacitorBluetoothAdapter()]
 *     )
 *   ]
 * })
 * export class AppModule {}
 * ```
 */
@NgModule({})
export class NgxPosPrintModule {
  static forRoot(
    config?: PosPrintConfig,
    customDrivers?: PrintDriverAdapter[]
  ): ModuleWithProviders<NgxPosPrintModule> {
    const providers: Array<{ provide: unknown; useValue: unknown }> = [
      { provide: POS_PRINT_CONFIG, useValue: config ?? {} },
    ];
    if (customDrivers?.length) {
      providers.push({ provide: POS_PRINT_CUSTOM_DRIVERS, useValue: customDrivers });
    }
    return { ngModule: NgxPosPrintModule, providers };
  }
}
