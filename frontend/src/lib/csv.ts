/**
 * Minimal CSV parser for the bulk-upload flow -- handles simple
 * comma-separated values with optional double-quoted fields (and doubled
 * "" for an escaped quote). Doesn't handle embedded newlines inside a
 * quoted field. Fine for a flat request-per-row sheet; not a general CSV
 * parser.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const header = parseLine(lines[0]!);
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    const row: Record<string, string> = {};
    header.forEach((key, i) => {
      row[key.trim()] = (values[i] ?? "").trim();
    });
    return row;
  });
}

function parseLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}
