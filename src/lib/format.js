const WIDE_RE = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;

export function displayWidth(text) {
  let width = 0;
  for (const ch of String(text)) {
    width += WIDE_RE.test(ch) ? 2 : 1;
  }
  return width;
}

export function padEndWide(text, width) {
  const str = String(text);
  const pad = Math.max(0, width - displayWidth(str));
  return str + ' '.repeat(pad);
}

export function padStartWide(text, width) {
  const str = String(text);
  const pad = Math.max(0, width - displayWidth(str));
  return ' '.repeat(pad) + str;
}

export function truncateWide(text, width) {
  const str = String(text);
  if (displayWidth(str) <= width) return str;
  let out = '';
  let used = 0;
  for (const ch of str) {
    const w = WIDE_RE.test(ch) ? 2 : 1;
    if (used + w > width - 1) break;
    out += ch;
    used += w;
  }
  return out + '…';
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let value = n / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[index]}`;
}

export function formatAge(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'unknown';
  const days = ms / 86400000;
  if (days < 1 / 24) {
    const minutes = Math.max(1, Math.round(ms / 60000));
    return `${minutes}m`;
  }
  if (days < 1) return `${Math.round(ms / 3600000)}h`;
  if (days < 90) return `${Math.round(days)}d`;
  if (days < 730) return `${(days / 30.44).toFixed(1)}mo`;
  return `${(days / 365.25).toFixed(1)}y`;
}

export function formatDate(input) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (v) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatPercent(value, digits = 0) {
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

export function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Number(value) || 0);
}

export function renderTable(headers, rows, { align = [] } = {}) {
  const columns = headers.length;
  const widths = headers.map((h) => displayWidth(h));
  const normalized = rows.map((row) => {
    const cells = [];
    for (let i = 0; i < columns; i += 1) {
      cells.push(row[i] === undefined || row[i] === null ? '' : String(row[i]));
    }
    return cells;
  });

  for (const row of normalized) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i], displayWidth(cell));
    });
  }

  const renderRow = (cells) =>
    cells
      .map((cell, i) => {
        const mode = align[i] || 'left';
        if (mode === 'right') return padStartWide(cell, widths[i]);
        if (mode === 'center') {
          const total = widths[i] - displayWidth(cell);
          const left = Math.floor(total / 2);
          return ' '.repeat(Math.max(0, left)) + cell + ' '.repeat(Math.max(0, total - left));
        }
        return padEndWide(cell, widths[i]);
      })
      .join('  ')
      .replace(/\s+$/, '');

  const lines = [];
  lines.push(renderRow(headers));
  lines.push(widths.map((w) => '─'.repeat(w)).join('  '));
  for (const row of normalized) lines.push(renderRow(row));
  return lines.join('\n');
}

export function bulletList(items, { indent = '  ' } = {}) {
  return items.map((item) => `${indent}• ${item}`).join('\n');
}