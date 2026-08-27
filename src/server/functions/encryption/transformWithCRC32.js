import CRC32 from 'crc-32';
import CryptoJS from 'crypto-js';

// indianPocker 안의 모든 value에 uniqueCodeByTime() 값 붙이기
export default (obj, keypair, role) => {
  const cryptoException = (str) => ['SXIEUDBLPN'].includes(str); // AES secret key일 경우 hash 생성 안함
  const strsException = (str) => ['QGAMLYWOKB'].includes(str); // PUBLIC_CARD_STRS 일 경우 hash 생성 안함
  // TNUFGJXDCM: PUBLIC_CARD_NUMS | PLHGVIEBNQ: PRIVATE_CARD_NUMS
  const numsException = (str) => ['TNUFGJXDCM', 'PLHGVIEBNQ'].includes(str); // NUMS의 v는 shuffle
  const numsExceptionPublic = (str) => ['TNUFGJXDCM'].includes(str); // public key 암호화
  const numsExceptionPrivate = (str) => ['PLHGVIEBNQ'].includes(str); // private key 암호화

  const result = {};

  for (const key in obj) {
    const entry = obj[key]; // k, v
    const newEntry = {};

    // k 처리
    if (entry.k) {
      const concatK = entry.k + (role === 'impolite' ? keypair.private.impolite : keypair.private.polite);
      newEntry.k = (CRC32.str(concatK) >>> 0).toString(16); // 양수로 변환
    }

    // v 처리
    if (typeof entry.v === 'string') {
      if (cryptoException(entry.k)) {
        newEntry.v = entry.v;
      } else {
        const concatV = entry.v + (role === 'impolite' ? keypair.private.impolite : keypair.private.polite);
        newEntry.v = (CRC32.str(concatV) >>> 0).toString(16); // 양수로 변환
      }
    } else if (typeof entry.v === 'object') {
      const nested = {};

      if (numsException(entry.k)) {
        // 1. 객체 -> [key, value] 배열로 변환
        const numsArr = Object.entries(entry.v);
        // 2. 배열을 무작위로 섞기 (Fisher-Yates Shuffle)
        const numsShuffled = numsArr
          .map((v) => v) // 원본 복사
          .sort(() => Math.random() - 0.5);
        // 3. 섞인 배열을 객체로 다시 변환
        const newNumsObj = Object.fromEntries(numsShuffled);

        if (numsExceptionPublic(entry.k)) {
          for (const innerKey in newNumsObj) {
            const concatInner = entry.v[innerKey] + keypair.public;
            nested[innerKey] = (CRC32.str(concatInner) >>> 0).toString(16); // 양수로 변환
          }
        } else if (numsExceptionPrivate(entry.k)) {
          const key = (role === 'impolite' ? keypair.private.polite : keypair.private.impolite);
          for (const innerKey in newNumsObj) {
            const concatInner = entry.v[innerKey] + key;
            nested[innerKey] = (CRC32.str(concatInner) >>> 0).toString(16); // 양수로 변환
          }
        }
      } else {
        if (strsException(entry.k)) {
          for (const innerKey in entry.v) {
            nested[innerKey] = entry.v[innerKey];
          }
        } else {
          const key = (role === 'impolite' ? keypair.private.impolite : keypair.private.polite);
          for (const innerKey in entry.v) {
            const concatInner = entry.v[innerKey] + key;
            nested[innerKey] = (CRC32.str(concatInner) >>> 0).toString(16); // 양수로 변환
          }
        }
      }
      newEntry.v = nested;
    }

    result[key] = newEntry;
  }

  return result;
};
