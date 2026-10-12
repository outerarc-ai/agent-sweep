export function pMapLimit(items, limit, mapper) {
  const list = Array.from(items);
  const size = Math.max(1, Math.min(limit || 1, list.length || 1));
  const results = new Array(list.length);
  let cursor = 0;

  return new Promise((resolve, reject) => {
    let settled = false;
    let active = 0;
    let completed = 0;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    const next = () => {
      if (settled) return;
      if (completed === list.length) {
        settled = true;
        resolve(results);
        return;
      }
      while (active < size && cursor < list.length) {
        const index = cursor;
        cursor += 1;
        active += 1;
        Promise.resolve()
          .then(() => mapper(list[index], index))
          .then((value) => {
            results[index] = value;
            active -= 1;
            completed += 1;
            next();
          }, fail);
      }
    };

    if (list.length === 0) {
      resolve(results);
      return;
    }
    next();
  });
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}