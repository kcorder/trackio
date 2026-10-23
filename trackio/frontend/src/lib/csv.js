function escapeCell(value) {
  if (value == null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function serializeCsv(rows, columns) {
  return [columns.map(escapeCell).join(","),
    ...rows.map((row) => columns.map((column) => escapeCell(row[column])).join(","))]
    .join("\n");
}

export function downloadCsv(rows, columns, filename) {
  const resolvedRows = typeof rows === "function" ? rows() : rows;
  if (!resolvedRows?.length) return;
  const blob = new Blob([serializeCsv(resolvedRows, columns)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
