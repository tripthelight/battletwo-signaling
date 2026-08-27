export default (input) => {
  const result = {};

  for (const key in input) {
    const entry = input[key];
    const k = entry.k;
    const v = entry.v;

    if (typeof v === 'string') {
      result[k] = v;
    } else if (typeof v === 'object' && v !== null) {
      // 중첩된 값들은 배열로 수집
      result[k] = Object.values(v);
    }
  }

  return result;
};
