export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function weightedMedian(items: { value: number; weight: number }[]): number | null {
  const list = items.filter((i) => i.weight > 0).sort((a, b) => a.value - b.value);
  const total = list.reduce((t, i) => t + i.weight, 0);
  if (!total) return null;
  let acc = 0;
  for (const i of list) {
    acc += i.weight;
    if (acc >= total / 2) return i.value;
  }
  return list[list.length - 1].value;
}
