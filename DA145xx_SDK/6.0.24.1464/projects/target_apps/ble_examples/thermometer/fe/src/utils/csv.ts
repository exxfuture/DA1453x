/**
 * Client-side CSV export. No dependency and no server round-trip: the data
 * being exported is already in the browser, and a Blob + temporary anchor
 * works in both the web app and the Capacitor WebView (no window.open, no
 * popup blocker, no native plugin).
 */

/** Values a spreadsheet would evaluate as a formula if left unescaped. */
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

function formatValue(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function escapeCell(value: unknown): string {
  let text = formatValue(value);

  // CSV injection guard: a cell starting with =/+/-/@ is executed as a formula
  // by Excel/Sheets, so an attacker-controlled field (a device model, a note)
  // could otherwise run on the exporter's machine. Neutralize with a leading
  // apostrophe, which spreadsheets strip on display.
  if (text.length > 0 && FORMULA_PREFIXES.includes(text[0])) {
    text = `'${text}`;
  }

  if (/[",\r\n]/.test(text) || text !== text.trim()) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Column order = first-seen key order across all rows (rows may be ragged). */
function collectColumns(rows: Record<string, unknown>[]): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  const columns = collectColumns(rows);
  const lines = [columns.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCell(row[column])).join(','));
  }
  // RFC 4180 line endings — Excel on Windows still cares.
  return lines.join('\r\n');
}

/**
 * Builds a CSV from `rows` and triggers a browser download.
 * No-ops on an empty row set (callers should disable their export control
 * rather than hand the user a blank file).
 */
export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (rows.length === 0) return;

  const name = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`;
  // BOM so Excel reads the file as UTF-8 instead of the local codepage.
  const blob = new Blob(['\uFEFF', toCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Deferred: revoking synchronously can cancel the download in some
    // WebViews before they've read the blob.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
