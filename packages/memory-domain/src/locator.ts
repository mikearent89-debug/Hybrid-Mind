import type { Locator } from './types';

/**
 * Whether a retrieved chunk at `chunk` covers the place an anchor at `anchor` points to, within the
 * same revision. A page matches the same page; a span matches an overlapping span; a row matches
 * the same row; `whole` matches anything in the revision.
 */
export function locatorCovers(anchor: Locator, chunk: Locator): boolean {
  if (anchor.type === 'whole' || chunk.type === 'whole') return true;
  if (anchor.type !== chunk.type) return false;
  switch (anchor.type) {
    case 'page':
      return chunk.type === 'page' && chunk.page === anchor.page;
    case 'span':
      return chunk.type === 'span' && chunk.start < anchor.end && anchor.start < chunk.end;
    case 'row':
      return chunk.type === 'row' && chunk.row === anchor.row;
    case 'time':
      return (
        chunk.type === 'time' &&
        chunk.startSeconds < anchor.endSeconds &&
        anchor.startSeconds < chunk.endSeconds
      );
    case 'image-region':
      return (
        chunk.type === 'image-region' &&
        chunk.x < anchor.x + anchor.w &&
        anchor.x < chunk.x + chunk.w &&
        chunk.y < anchor.y + anchor.h &&
        anchor.y < chunk.y + chunk.h
      );
  }
}

/** A short human-readable form, for search results and MCP output. */
export function describeLocator(locator: Locator): string {
  switch (locator.type) {
    case 'page':
      return `page ${locator.page}`;
    case 'span':
      return locator.quote ? `"${locator.quote}"` : `chars ${locator.start}-${locator.end}`;
    case 'row':
      return locator.column ? `row ${locator.row}, ${locator.column}` : `row ${locator.row}`;
    case 'time':
      return `${locator.startSeconds}s-${locator.endSeconds}s`;
    case 'image-region':
      return `image region ${locator.x},${locator.y} ${locator.w}x${locator.h}`;
    case 'whole':
      return 'whole document';
  }
}
