import { InjectionToken, makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core';
import type { PosPrintConfig, PrintDriverAdapter } from '../models/print.models';

/**
 * Injection token for the POS print configuration.
 * Provides an empty config by default so standalone apps work without explicit providers.
 */
export const POS_PRINT_CONFIG = new InjectionToken<PosPrintConfig>(
  'POS_PRINT_CONFIG',
  { providedIn: 'root', factory: () => ({}) }
);

/**
 * Injection token for custom print driver adapters.
 * Supports multiple adapters via multi-provider pattern.
 */
export const POS_PRINT_CUSTOM_DRIVERS = new InjectionToken<PrintDriverAdapter[]>(
  'POS_PRINT_CUSTOM_DRIVERS'
);

/**
 * Provides the ngx-pos-print services for standalone Angular applications.
 *
 * @example Basic usage
 * ```typescript
 * bootstrapApplication(AppComponent, {
 *   providers: [
 *     providePosPrint({ paperSize: 80 })
 *   ]
 * });
 * ```
 *
 * @example With custom Capacitor driver
 * ```typescript
 * bootstrapApplication(AppComponent, {
 *   providers: [
 *     providePosPrint(
 *       { paperSize: 80 },
 *       [new CapacitorBluetoothAdapter(), new CapacitorUsbAdapter()]
 *     )
 *   ]
 * });
 * ```
 *
 * @param config - Optional global configuration
 * @param customDrivers - Optional array of custom driver adapters for Capacitor/Cordova/Electron
 * @returns Environment providers for the POS print library
 */
export function providePosPrint(
  config?: PosPrintConfig,
  customDrivers?: PrintDriverAdapter[]
): EnvironmentProviders {
  const providers: Array<{ provide: InjectionToken<unknown>; useValue: unknown }> = [
    { provide: POS_PRINT_CONFIG, useValue: config ?? {} },
  ];

  if (customDrivers?.length) {
    providers.push({ provide: POS_PRINT_CUSTOM_DRIVERS, useValue: customDrivers });
  }

  return makeEnvironmentProviders(providers);
}
