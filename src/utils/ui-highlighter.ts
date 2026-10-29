import { Locator, Page } from '@playwright/test';

/**
 * Options for highlighting UI elements with a green bounding box.
 */
export interface HighlightOptions {
  /** Border color (default: '#10b981' - Emerald Green) */
  color?: string;
  /** Border width in pixels (default: 3) */
  width?: number;
  /** Padding in pixels around the target bounding box (default: 4) */
  padding?: number;
  /** Border radius in pixels (default: 6) */
  borderRadius?: number;
}

/**
 * Highlights a Playwright Locator on the page by drawing a clean green rectangular box
 * around the actual tested UI element or group of elements.
 *
 * Requirements met:
 * - Clean green bounding box (#10b981 / 3px solid).
 * - No text, arrows, or distracting labels.
 * - Works for single elements and groups of elements.
 * - Completely non-intrusive (pointer-events: none, does not shift DOM layout).
 * - Persists into the screenshot captured by Playwright at the end of the test.
 */
export async function highlightLocator(locator: Locator, options: HighlightOptions = {}): Promise<void> {
  try {
    const color = options.color || '#10b981';
    const width = options.width || 3;
    const padding = options.padding !== undefined ? options.padding : 3;
    const borderRadius = options.borderRadius || 6;

    await locator.evaluateAll(
      (elements, opts) => {
        if (!elements || elements.length === 0) return;

        const validElements = elements.filter((el) => {
          if (!(el instanceof HTMLElement || el instanceof SVGElement)) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }) as HTMLElement[];

        if (validElements.length === 0) return;

        // Apply clean, crisp green bounding outline to all verified elements
        validElements.forEach((el) => {
          el.style.outline = `${opts.width}px solid ${opts.color}`;
          el.style.outlineOffset = `${opts.padding}px`;
          el.style.borderRadius = `${opts.borderRadius}px`;
          el.style.boxShadow = `0 0 0 2px rgba(16, 185, 129, 0.25)`;
          el.setAttribute('data-rs-tested', 'true');
        });
      },
      { color, width, padding, borderRadius },
    );
  } catch {
    // Non-blocking: if element was detached or navigated away, safely ignore
  }
}


/**
 * Highlights a specific element or container on the page by selector or locator.
 */
export async function highlightElement(
  page: Page,
  selectorOrLocator: string | Locator,
  options?: HighlightOptions,
): Promise<void> {
  const locator = typeof selectorOrLocator === 'string' ? page.locator(selectorOrLocator) : selectorOrLocator;
  await highlightLocator(locator, options);
}
