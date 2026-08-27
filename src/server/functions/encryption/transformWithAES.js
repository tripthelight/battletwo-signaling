import CryptoJS from 'crypto-js';

// indianPocker 안의 모든 value에 uniqueCodeByTime() 값 붙이기
export default (obj, keypair) => {
  const result = {};

  for (const key in obj) {
    const entry = obj[key];
    const newEntry = {};

    // k 처리
    if (entry.k) {
      const concatK = entry.k + keypair;
      newEntry.k = CryptoJS.AES.encrypt(concatK, keypair).toString();
    }

    // v 처리
    if (typeof entry.v === 'string') {
      const concatV = entry.v + keypair;
      newEntry.v = CryptoJS.AES.encrypt(concatV, keypair).toString();
    } else if (typeof entry.v === 'object') {
      const nested = {};
      for (const innerKey in entry.v) {
        const concatInner = entry.v[innerKey] + keypair;
        nested[innerKey] = CryptoJS.AES.encrypt(concatInner, keypair).toString();
      }
      newEntry.v = nested;
    }

    result[key] = newEntry;
  }

  return result;
};
