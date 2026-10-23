const SCALE = 4;
const PADDING = 16;
const LINE_HEIGHT = 16;

export function wrapImageText(value, maxWidth, measure) {
  const lines = [];
  let line = "";
  for (const char of String(value ?? "")) {
    const candidate = line + char;
    if (line && measure(candidate) > maxWidth) {
      lines.push(line);
      line = char;
    } else {
      line = candidate;
    }
  }
  if (line || lines.length === 0) lines.push(line);
  return lines;
}

export function layoutImageLegend(entries, dashEntries, width, measure, rangeBand = false) {
  const textWidth = Math.max(40, width - PADDING * 2 - 22);
  const rows = [
    ...entries.map((entry) => ({
      kind: "color",
      color: entry.color,
      lines: wrapImageText(entry.name, textWidth, measure),
    })),
    ...dashEntries.map((entry) => ({
      kind: "dash",
      pattern: entry.pattern,
      lines: wrapImageText(entry.name, textWidth, measure),
    })),
  ];
  if (rangeBand && entries.length) {
    rows.push({
      kind: "band",
      color: entries[0].color,
      lines: wrapImageText("Shaded band: observed run range", textWidth, measure),
    });
  }
  return rows.map((row) => ({ ...row, height: Math.max(22, row.lines.length * LINE_HEIGHT + 6) }));
}

function themeColor(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load exported chart image"));
    image.src = url;
  });
}

function pngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not encode chart PNG"));
    }, "image/png");
  });
}

export async function downloadChartImage({
  view,
  filename,
  title,
  legendEntries = [],
  dashLegendEntries = [],
  rangeBand = false,
}) {
  if (view.runAsync) await view.runAsync();
  const chart = await loadImage(await view.toImageURL("png", SCALE));
  const width = Math.max(240, chart.naturalWidth / SCALE);
  const chartHeight = chart.naturalHeight / SCALE;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable for PNG export");

  context.font = "600 14px sans-serif";
  const titleLines = title
    ? wrapImageText(title, width - PADDING * 2, (text) => context.measureText(text).width)
    : [];
  const titleHeight = titleLines.length ? titleLines.length * 20 + 20 : 0;
  context.font = "12px sans-serif";
  const legendRows = layoutImageLegend(
    legendEntries,
    dashLegendEntries,
    width,
    (text) => context.measureText(text).width,
    rangeBand,
  );
  const legendHeight = legendRows.length
    ? PADDING * 2 + legendRows.reduce((total, row) => total + row.height, 0)
    : 0;
  const height = titleHeight + chartHeight + legendHeight;
  canvas.width = Math.ceil(width * SCALE);
  canvas.height = Math.ceil(height * SCALE);
  context.setTransform(SCALE, 0, 0, SCALE, 0, 0);

  const background = themeColor("--background-fill-primary", "#ffffff");
  const textColor = themeColor("--body-text-color", "#1f2937");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  context.fillStyle = textColor;
  context.font = "600 14px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "top";
  titleLines.forEach((line, index) => context.fillText(line, width / 2, 12 + index * 20));
  context.drawImage(chart, (width - chart.naturalWidth / SCALE) / 2, titleHeight,
    chart.naturalWidth / SCALE, chartHeight);

  context.font = "12px sans-serif";
  context.textAlign = "left";
  let y = titleHeight + chartHeight + PADDING;
  for (const row of legendRows) {
    if (row.kind === "color") {
      context.fillStyle = row.color;
      context.beginPath();
      context.arc(PADDING + 5, y + 7, 5, 0, Math.PI * 2);
      context.fill();
    } else if (row.kind === "dash") {
      context.strokeStyle = textColor;
      context.lineWidth = 2;
      context.setLineDash(row.pattern);
      context.beginPath();
      context.moveTo(PADDING, y + 7);
      context.lineTo(PADDING + 16, y + 7);
      context.stroke();
      context.setLineDash([]);
    } else {
      context.fillStyle = row.color;
      context.globalAlpha = 0.2;
      context.fillRect(PADDING, y + 2, 16, 10);
      context.globalAlpha = 1;
    }
    context.fillStyle = textColor;
    row.lines.forEach((line, index) => {
      context.fillText(line, PADDING + 22, y + index * LINE_HEIGHT);
    });
    y += row.height;
  }

  const objectUrl = URL.createObjectURL(await pngBlob(canvas));
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
